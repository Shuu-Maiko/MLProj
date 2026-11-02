"""Serving wrapper around the winning forecaster.

Reuses the exact window builder from training (models.deep.dataset), so a feature can
never be assembled one way for the backtest and another way for the API — the failure
mode that quietly makes an online model worse than the evaluated one.
"""

from __future__ import annotations

import json
import pathlib
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from models.common import PanelBundle, state_scales  # noqa: E402
from models.deep.dataset import (FORECAST_LEN, HISTORY_LEN, WEATHER_CHANNELS,  # noqa: E402
                                 build_windows, weather_stats)
from models.deep.nets import MODELS, QUANTILES  # noqa: E402

ARTIFACTS = ROOT / "artifacts"
CHECKPOINT = ARTIFACTS / "models" / "deep" / "itransformer.pt"
PANEL = ROOT / "data" / "processed" / "panel.parquet"

# Selected on accuracy *and* weather elasticity: see artifacts/results/MODEL_SELECTION.md.
# iTransformer has the lower MAE but its response to a 30 C temperature ramp is +3% and
# non-monotonic, which would make the game's heatwave scenario do nothing.
SERVED_MODEL = "tft"
REGISTRY = ROOT / "config" / "state_registry.json"

# Hour 0 of the game clock, chosen so the whole playable range sits inside the real
# measurement window and history lookups never fall off the end.
DATA_EPOCH = pd.Timestamp("2026-01-01T00:00:00")
MAX_HOURS = int((pd.Timestamp("2026-10-31T23:00:00") - DATA_EPOCH).total_seconds() // 3600)


class ForecastError(RuntimeError):
    pass


@dataclass
class ForecastOutcome:
    """A forecast plus the origin actually used, so a snapped window is never hidden."""

    points: pd.DataFrame
    origin_used: pd.Timestamp
    origin_requested: pd.Timestamp
    state: str

    @property
    def shifted_hours(self) -> int:
        return int((self.origin_requested - self.origin_used).total_seconds() // 3600)


class Forecaster:
    def __init__(self, device: str = "cpu", model: str = SERVED_MODEL) -> None:
        self.bundle = PanelBundle.load()
        self.panel = self.bundle.panel
        self.scales = state_scales(self.bundle)
        tr_lo, tr_hi = self.bundle.splits["train"]
        self.stats = weather_stats(self.panel, self.bundle.states, tr_lo, tr_hi)
        self.registry = json.loads(REGISTRY.read_text())
        self.device = torch.device(device)

        # weights_only=True: a model file should never be able to execute code on load.
        blob = torch.load(ARTIFACTS / "models" / "deep" / f"{model}.pt",
                          map_location=self.device, weights_only=True)
        name = blob["meta"]["name"]
        self.model = MODELS[name]().to(self.device).eval()
        self.model.load_state_dict(blob["state_dict"])
        self.meta = blob["meta"]
        self.name = name

    # -- helpers -------------------------------------------------------------

    def timestamp(self, hour: int) -> pd.Timestamp:
        return DATA_EPOCH + pd.Timedelta(hours=hour)

    def clamp_origin(self, hour: int, horizon: int) -> int:
        """Keep the origin inside the panel with enough history and room ahead."""
        last = int((self.panel.index[-1] - DATA_EPOCH).total_seconds() // 3600)
        return max(HISTORY_LEN, min(hour, last - horizon - 1))

    def _window(self, state: str, origin_hour: int, horizon: int) -> tuple[dict, pd.Timestamp]:
        """Latest complete history window ending at or before the requested origin.

        Several states have real gaps in the 15-minute feed, so an exact-hour match would
        fail often; snapping backwards to a complete window keeps the service usable and
        the caller is told which origin was actually used.
        """
        origin = self.timestamp(origin_hour)
        # States have real gaps in the 15-minute feed, so search back far enough to
        # always find a complete window; the caller reports how far it had to reach.
        lo = origin - pd.Timedelta(hours=HISTORY_LEN + 720)
        # The network always needs its full training horizon of future covariates, even
        # when the caller asked for a shorter forecast.
        hi = origin + pd.Timedelta(hours=max(horizon, FORECAST_LEN))
        if lo < self.panel.index[0]:
            raise ForecastError(f"not enough measured history before {origin} for {state}")
        block = build_windows(
            self.panel, state, self.scales, self.stats[state],
            lo, hi + pd.Timedelta(hours=1), stride=1,
        )
        if not len(block["y"]):
            raise ForecastError(f"no complete {HISTORY_LEN}h history window at or before {origin} for {state}")
        eligible = np.flatnonzero(block["origin"] <= np.datetime64(origin))
        if not len(eligible):
            raise ForecastError(f"no complete history window at or before {origin} for {state}")
        i = int(eligible[-1])
        used = pd.Timestamp(block["origin"][i])
        return {k: block[k][i] for k in ("x_past", "x_known", "y")}, used

    def _apply_scenario(self, x_known: np.ndarray, state: str,
                        scenario: dict) -> np.ndarray:
        """Overwrite the future weather channels with the player's scenario.

        Only known-future covariates may be edited: the past stays as measured, which is
        what keeps a scenario comparable to the backtest.
        """
        out = x_known.copy()
        n_cal = 6  # calendar channels occupy the first rows of x_known
        stats = self.stats[state]
        for j, var in enumerate(WEATHER_CHANNELS):
            key = {"temperature_2m": "temperature_c", "relative_humidity_2m": "humidity_pct",
                   "shortwave_radiation": "irradiance_wm2", "wind_speed_10m": "wind_kmh",
                   "precipitation": "precip_mm"}[var]
            if key not in scenario or scenario[key] is None:
                continue
            value = scenario[key]
            series = np.full(out.shape[1], float(value), dtype=np.float32) \
                if np.isscalar(value) else np.asarray(value, dtype=np.float32)
            if series.shape[0] != out.shape[1]:
                raise ForecastError(
                    f"{key} must be a scalar or have {out.shape[1]} values (the model's fixed horizon)")
            mu, sd = stats[var]
            out[n_cal + j] = (series - mu) / sd
        return out

    # -- public API ----------------------------------------------------------

    def forecast(self, state: str, origin_hour: int, horizon: int = FORECAST_LEN,
                 scenario: dict | None = None) -> ForecastOutcome:
        if state not in self.scales:
            raise ForecastError(f"unknown state {state}")
        horizon = int(min(max(horizon, 1), FORECAST_LEN))
        origin_hour = self.clamp_origin(origin_hour, horizon)
        w, used = self._window(state, origin_hour, horizon)
        x_known = self._apply_scenario(w["x_known"], state, scenario or {})

        with torch.no_grad():
            q = self.model(torch.tensor(w["x_past"], device=self.device).unsqueeze(0),
                           torch.tensor(x_known, device=self.device).unsqueeze(0))[0]
        q = q.cpu().numpy() * self.scales[state]  # (3, FORECAST_LEN) in MW
        # The network always predicts the full training horizon; shorter requests are a
        # slice of it, not a different forward pass.
        q = q[:, :horizon]

        times = pd.date_range(used + pd.Timedelta(hours=1), periods=horizon, freq="h")
        points = pd.DataFrame({
            "timestamp": times,
            "p10MW": np.minimum(q[0], q[2]),
            "p50MW": q[1],
            "p90MW": np.maximum(q[0], q[2]),
        })
        return ForecastOutcome(points=points, origin_used=used,
                               origin_requested=self.timestamp(origin_hour), state=state)

    def history(self, state: str, origin_hour: int, hours: int = 72) -> pd.DataFrame:
        end = self.timestamp(self.clamp_origin(origin_hour, 1))
        col = f"demand__{state}"
        if col not in self.panel:
            raise ForecastError(f"unknown state {state}")
        s = self.panel[col].loc[:end].tail(hours)
        return pd.DataFrame({"timestamp": s.index, "measuredMW": s.to_numpy()})

    def weather_now(self, state: str, origin_hour: int) -> dict:
        end = self.timestamp(self.clamp_origin(origin_hour, 1))
        out = {}
        for var in WEATHER_CHANNELS:
            col = f"{var}__{state}"
            if col in self.panel:
                out[var] = float(self.panel[col].loc[:end].iloc[-1])
        return out

    def future_weather(self, state: str, origin: pd.Timestamp, horizon: int) -> pd.DataFrame:
        """Measured weather over the forecast window, so the game's sky matches its model."""
        start = origin + pd.Timedelta(hours=1)
        cols = {}
        for var in WEATHER_CHANNELS:
            col = f"{var}__{state}"
            if col in self.panel:
                cols[var] = self.panel[col].loc[start:start + pd.Timedelta(hours=horizon - 1)]
        return pd.DataFrame(cols)

    def info(self) -> dict:
        return {
            "model": self.name,
            "params": self.meta.get("params"),
            "trained_on": "Merit India state-level 15-minute demand (hourly resampled) + ERA5 weather",
            "window": [str(self.panel.index[0]), str(self.panel.index[-1])],
            "states": len(self.bundle.states),
            "horizon_hours": FORECAST_LEN,
            "quantiles": list(QUANTILES),
            "game_epoch": str(DATA_EPOCH),
            "max_game_hours": MAX_HOURS,
        }
