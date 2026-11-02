"""Windowed multivariate dataset for the deep forecasters.

Shapes follow the convention the transformer models expect:
  x_past   (C_past, L)      history of every channel up to and including origin t
  x_known  (C_known, H)     future-known covariates for t+1 .. t+H
  y        (H,)             normalised demand over the horizon
Rows are keyed by (state, origin) so evaluation can be joined back to the LightGBM
metrics on identical (state, horizon) slices.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from models.common import PanelBundle, state_scales  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
PROCESSED = ROOT / "data" / "processed"

HISTORY_LEN = 168
FORECAST_LEN = 24
EVAL_HORIZONS = (1, 6, 12, 24)

WEATHER_CHANNELS = [
    "temperature_2m", "relative_humidity_2m", "shortwave_radiation",
    "wind_speed_10m", "precipitation",
]


def _calendar_channels(panel: pd.DataFrame) -> pd.DataFrame:
    return panel[["hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend", "is_holiday"]]


def channel_names(state: str) -> tuple[list[str], list[str]]:
    """(past-only channels, known-future channels) for one state."""
    past = ["demand"] + [f"{v}_{state}" for v in WEATHER_CHANNELS]
    known = (["hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend", "is_holiday"]
             + [f"{v}_{state}" for v in WEATHER_CHANNELS])
    return past, known


def weather_stats(panel: pd.DataFrame, states: list[str],
                  train_lo: pd.Timestamp, train_hi: pd.Timestamp) -> dict[str, dict[str, tuple[float, float]]]:
    """Per-state weather mean/std from the TRAIN window only, reused by every split."""
    stats = {}
    mask = (panel.index >= train_lo) & (panel.index < train_hi)
    for state in states:
        stats[state] = {}
        for v in WEATHER_CHANNELS:
            arr = panel.loc[mask, f"{v}__{state}"].to_numpy(np.float64)
            mu, sd = float(np.nanmean(arr)), float(np.nanstd(arr))
            stats[state][v] = (mu, sd if sd > 1e-6 else 1.0)
    return stats


def build_windows(panel: pd.DataFrame, state: str, scales: dict[str, float],
                  stats: dict[str, tuple[float, float]],
                  origin_lo: pd.Timestamp, origin_hi: pd.Timestamp,
                  stride: int = 1) -> dict[str, np.ndarray]:
    """Sliding windows whose origin falls in [origin_lo, origin_hi)."""
    past_ch, known_ch = channel_names(state)
    idx = panel.index
    pos = np.searchsorted(idx.values, np.datetime64(origin_lo), side="left")
    end = np.searchsorted(idx.values, np.datetime64(origin_hi), side="left")
    pos = np.arange(pos, end - FORECAST_LEN, stride)

    demand = panel[f"demand__{state}"].to_numpy(np.float64)
    weather = {v: panel[f"{v}__{state}"].to_numpy(np.float64) for v in WEATHER_CHANNELS}
    cal = _calendar_channels(panel)
    scale = scales[state]

    n_ch_past, n_ch_known = len(past_ch), len(known_ch)
    xp = np.full((len(pos), n_ch_past, HISTORY_LEN), np.nan, dtype=np.float32)
    xk = np.full((len(pos), n_ch_known, FORECAST_LEN), np.nan, dtype=np.float32)
    yy = np.full((len(pos), FORECAST_LEN), np.nan, dtype=np.float32)
    origins = np.empty(len(pos), dtype="datetime64[h]")

    for i, p0 in enumerate(pos):
        t = p0 + HISTORY_LEN - 1          # origin index (last observed hour)
        h0, h1 = t - HISTORY_LEN + 1, t + 1
        f0, f1 = t + 1, t + 1 + FORECAST_LEN
        if h0 < 0 or f1 > len(idx):
            continue
        origins[i] = idx[t].to_datetime64()
        xp[i, 0] = demand[h0:h1] / scale
        for j, v in enumerate(WEATHER_CHANNELS, start=1):
            mu, sd = stats[v]
            xp[i, j] = (weather[v][h0:h1] - mu) / sd
        for j, c in enumerate(["hour_sin", "hour_cos", "dow_sin", "dow_cos",
                               "is_weekend", "is_holiday"]):
            xk[i, j] = cal[c].to_numpy()[f0:f1]
        for j, v in enumerate(WEATHER_CHANNELS, start=6):
            mu, sd = stats[v]
            xk[i, j] = (weather[v][f0:f1] - mu) / sd
        yy[i] = demand[f0:f1] / scale

    valid = ~np.isnan(yy).any(axis=1) & ~np.isnan(xp).any(axis=(1, 2))
    return {"x_past": xp[valid], "x_known": xk[valid], "y": yy[valid],
            "origin": origins[valid], "state": state}


class WindowDataset(Dataset):
    def __init__(self, blocks: list[dict[str, np.ndarray]]):
        counts = [len(b["y"]) for b in blocks]
        self.x_past = np.concatenate([b["x_past"] for b in blocks])
        self.x_known = np.concatenate([b["x_known"] for b in blocks])
        self.y = np.concatenate([b["y"] for b in blocks])
        self.origin = np.concatenate([b["origin"] for b in blocks])
        self.state = np.repeat([b["state"] for b in blocks], counts)

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, i: int):
        return (torch.from_numpy(self.x_past[i]), torch.from_numpy(self.x_known[i]),
                torch.from_numpy(self.y[i]))


if __name__ == "__main__":
    bundle = PanelBundle.load()
    panel = bundle.panel
    scales = state_scales(bundle)
    tr_lo, tr_hi = bundle.splits["train"]
    stats = weather_stats(panel, bundle.states, tr_lo, tr_hi)
    b = build_windows(panel, "DL", scales, stats["DL"], tr_lo, tr_hi, stride=24)
    print("DL train windows:", b["x_past"].shape, b["x_known"].shape, b["y"].shape)
    print("NaN share:", float(np.isnan(b["x_past"]).mean()), float(np.isnan(b["y"]).mean()))
    print("demand normalised range:", float(b["x_past"][:, 0].min()),
          float(b["x_past"][:, 0].max()))
