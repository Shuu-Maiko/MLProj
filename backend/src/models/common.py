"""Leakage-safe feature construction and forecasting metrics shared by every model.

The rule enforced here: a row is (origin t, horizon h) and may only read demand at
times <= t. Anything at t+1..t+h must come from known-future covariates (calendar,
weather the game itself supplies). Shift amounts are therefore h-relative, never
absolute slices, so a horizon-24 row cannot see its own answer.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
CONFIG = ROOT / "config"

HORIZONS = (1, 6, 12, 24)
WEATHER_VARS = (
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "shortwave_radiation",
    "wind_speed_10m",
    "precipitation",
)
CALENDAR_COLS = [
    "hour", "dow", "month", "day_of_year", "is_weekend", "is_holiday",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
]


@dataclass
class PanelBundle:
    panel: pd.DataFrame
    states: list[str]
    splits: dict[str, tuple[pd.Timestamp, pd.Timestamp]]
    registry: dict

    @staticmethod
    def load() -> "PanelBundle":
        panel = pd.read_parquet(PROCESSED / "panel.parquet")
        registry = json.loads((CONFIG / "state_registry.json").read_text())
        raw_splits = json.loads((PROCESSED / "splits.json").read_text())
        splits = {k: (pd.Timestamp(v[0]), pd.Timestamp(v[1])) for k, v in raw_splits.items()}
        states = [c[len("demand__"):] for c in panel.columns
                  if c.startswith("demand__") and c != "demand__IND"]
        return PanelBundle(panel, sorted(states), splits, registry)


def weather_cols_for(state: str) -> list[str]:
    return [f"{v}__{state}" for v in WEATHER_VARS]


DEMAND_HISTORY_COLS = (
    "y", "lag_at_origin", "lag_6h", "lag_24h", "lag_48h", "lag_168h",
    "roll_mean_24h", "roll_std_24h", "roll_max_24h", "roll_min_24h", "week_mean_168h",
)


def state_scales(bundle: PanelBundle) -> dict[str, float]:
    """Median demand over the TRAIN window only, used to normalise each series.

    State loads span three orders of magnitude (Sikkim ~60 MW, Maharashtra ~24 GW),
    so a pooled model trained in MW spends all its capacity on the biggest states and
    one shared interval width is meaningless. Scale is taken from the training period
    so it is a constant the forecaster could legitimately know at prediction time.
    """
    lo, hi = bundle.splits["train"]
    out = {}
    for state in bundle.states:
        s = bundle.panel[f"demand__{state}"].loc[lo:hi]
        med = float(s.median())
        out[state] = med if med > 1.0 else 1.0
    return out


def build_supervised(bundle: PanelBundle, states: list[str] | None = None,
                     horizons: tuple[int, ...] = HORIZONS,
                     normalize: bool = True) -> pd.DataFrame:
    """One row per (state, origin, horizon) with target `y` and its features.

    Built state-by-state and cast to float32 as each block is finished: stacking all
    states as float64 first roughly doubles peak memory and gets the process killed.
    """
    panel = bundle.panel
    national = panel["demand__IND"]
    nat_roll = national.rolling(24).mean()
    scales = state_scales(bundle) if normalize else {}
    lo, hi = bundle.splits["train"]
    nat_scale = float(national.loc[lo:hi].median()) if normalize else 1.0
    rows = []
    for state in (states or bundle.states):
        y = panel[f"demand__{state}"]
        wc = weather_cols_for(state)
        weat = panel[wc]
        per_state = []
        for h in horizons:
            f = pd.DataFrame(index=panel.index)
            f["y"] = y.shift(-h)
            # Demand history strictly at or before the origin t.
            f["lag_at_origin"] = y
            f["lag_6h"] = y.shift(6)
            f["lag_24h"] = y.shift(24)
            f["lag_48h"] = y.shift(48)
            f["lag_168h"] = y.shift(168)
            f["roll_mean_24h"] = y.rolling(24).mean()
            f["roll_std_24h"] = y.rolling(24).std()
            f["roll_max_24h"] = y.rolling(24).max()
            f["roll_min_24h"] = y.rolling(24).min()
            f["week_mean_168h"] = y.rolling(168, min_periods=24).mean()
            # National context at the origin only.
            f["nat_lag_at_origin"] = national
            f["nat_roll_mean_24h"] = nat_roll
            # Known-future covariates: calendar at t+h, weather at t+h and at t.
            # Weather columns are renamed to generic per-row features: keeping the
            # state suffix would leave every other state's rows NaN in that column,
            # and the model would silently learn from one state only.
            f[CALENDAR_COLS] = panel[CALENDAR_COLS].shift(-h)
            for c in wc:
                var = c.split("__")[0]
                f[f"w_fut_{var}"] = weat[c].shift(-h).to_numpy()
                f[f"w_org_{var}"] = weat[c].to_numpy()
            f["horizon"] = float(h)
            f["origin"] = panel.index
            f["target_time"] = panel.index + pd.Timedelta(hours=h)
            per_state.append(f)
        block = pd.concat(per_state)
        block["state"] = state
        if normalize:
            scale = scales[state]
            for c in DEMAND_HISTORY_COLS:
                if c in block:
                    block[c] = block[c] / scale
            block["nat_lag_at_origin"] = block["nat_lag_at_origin"] / nat_scale
            block["nat_roll_mean_24h"] = block["nat_roll_mean_24h"] / nat_scale
        block["scale_MW"] = np.float32(scales.get(state, 1.0))
        for c in block.select_dtypes(include=["float64"]).columns:
            block[c] = block[c].astype("float32")
        rows.append(block)
        del per_state, block
    out = pd.concat(rows, ignore_index=True)
    del rows
    out["state"] = pd.Categorical(out["state"])
    keep = (out["y"].notna() & out["lag_168h"].notna() & out["w_fut_temperature_2m"].notna()
            & out["week_mean_168h"].notna())
    return out[keep].reset_index(drop=True)


def feature_columns(df: pd.DataFrame) -> list[str]:
    drop = {"y", "origin", "target_time", "state", "scale_MW"}
    return [c for c in df.columns if c not in drop]


STATE_FEATURE = "state_code"


def state_mapping(df: pd.DataFrame) -> dict[str, int]:
    return {s: i for i, s in enumerate(sorted(df["state"].cat.categories))}


def to_matrix(df: pd.DataFrame, feats: list[str], smap: dict[str, int]) -> np.ndarray:
    """One float32 block for all features; copies per split would double peak memory."""
    X = np.empty((len(df), len(feats) + 1), dtype=np.float32)
    X[:, :len(feats)] = df[feats].to_numpy(dtype=np.float32)
    X[:, len(feats)] = df["state"].map(smap).to_numpy(dtype=np.float32)
    return X


def split_mask(df: pd.DataFrame, split: str, splits: dict) -> np.ndarray:
    """Boolean mask for a split. An origin must fall inside the window and so must its
    target, otherwise a training row would be supervised on an evaluation-period value."""
    lo, hi = splits[split]
    return ((df["origin"] >= lo) & (df["origin"] < hi) & (df["target_time"] <= hi)).to_numpy()


def mae(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean(np.abs(y - p)))


def rmse(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y - p) ** 2)))


def mape(y: np.ndarray, p: np.ndarray) -> float:
    # Sikkim/Mizoram-scale series can legitimately dip near zero; dividing by those
    # produces inf-dominated averages, so only meaningful loads enter the percentage.
    keep = y > 50.0
    if not keep.any():
        return float("nan")
    return float(np.mean(np.abs((y[keep] - p[keep]) / y[keep])) * 100)


def pinball(y: np.ndarray, q_pred: np.ndarray, alpha: float) -> float:
    diff = y - q_pred
    return float(np.mean(np.maximum(alpha * diff, (alpha - 1) * diff)))


def interval_coverage(y: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float:
    return float(np.mean((y >= lo) & (y <= hi)) * 100)


def interval_width(lo: np.ndarray, hi: np.ndarray) -> float:
    return float(np.mean(hi - lo))


def report_metrics(y: np.ndarray, p: np.ndarray, lo: np.ndarray | None = None,
                   hi: np.ndarray | None = None) -> dict:
    m = {"MAE_MW": round(mae(y, p), 1), "RMSE_MW": round(rmse(y, p), 1),
         "MAPE_pct": round(mape(y, p), 2)}
    if lo is not None and hi is not None:
        m["PI80_coverage_pct"] = round(interval_coverage(y, lo, hi), 1)
        m["PI80_width_MW"] = round(interval_width(lo, hi), 1)
    return m
