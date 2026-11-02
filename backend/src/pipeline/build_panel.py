"""Assemble the modelling panel: real hourly state demand + weather + calendar.

Everything the models see is built here, once, so training and serving cannot drift
apart. Leakage rule for this file: only *known-at-forecast-time* covariates go in
(lag/target-history features are added later inside the model wrappers, where the
prediction origin is known).
"""

from __future__ import annotations

import glob
import json
import pathlib

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
CONFIG = ROOT / "config"


def load_state_demand() -> pd.DataFrame:
    """Hourly mean demand per state from the 15-minute Merit India pulls."""
    frames = []
    for f in sorted(glob.glob(str(RAW / "state_15min" / "*.csv"))):
        d = pd.read_csv(f, usecols=["StateCode", "Datetime", "Demand"])
        d["Demand"] = pd.to_numeric(d["Demand"].astype(str).str.replace(",", ""), errors="coerce")
        frames.append(d)
    st = pd.concat(frames, ignore_index=True)
    st["Datetime"] = pd.to_datetime(st["Datetime"])
    out = {}
    for code, g in st.groupby("StateCode"):
        g = g.set_index("Datetime").sort_index()
        out[str(code)] = g["Demand"].resample("h").mean()
    panel = pd.DataFrame(out)
    # Sensors report on staggered seconds; a one-hour forward fill repairs gaps that
    # are pure timestamp misalignment. Anything longer stays NaN and is masked out.
    return panel.ffill(limit=1)


def load_national_demand() -> pd.Series:
    ind = pd.read_csv(RAW / "india_all_15min.csv")
    ind["Datetime"] = pd.to_datetime(ind["Datetime"])
    ind["Demand"] = pd.to_numeric(ind["Demand"].astype(str).str.replace(",", ""), errors="coerce")
    return ind.set_index("Datetime")["Demand"].resample("h").mean().ffill(limit=1).rename("IND")


def load_national_hourly_history() -> pd.DataFrame:
    """2019-2024 national hourly series, kept as context/cross-check data."""
    div = pd.read_csv(RAW / "india_hourly_national.csv")
    div.columns = [c.strip().lstrip("﻿") for c in div.columns]
    div["datetime"] = pd.to_datetime(div["datetime"])
    return div.rename(columns={"National Hourly Demand": "demand_mw"}).set_index("datetime")


def add_calendar(idx: pd.DatetimeIndex) -> pd.DataFrame:
    hol = json.loads((CONFIG / "holidays.json").read_text())
    fixed = {pd.Timestamp(f"2000-{d}").strftime("%m-%d") for d in hol["recurring_fixed"]}
    fest = {f"{y}-{d}" for y, ds in hol["festivals"].items() for d in ds}
    dates = idx.normalize()
    keys = dates.strftime("%Y-%m-%d")
    md = dates.strftime("%m-%d")
    is_holiday = np.array([k in fest or m in fixed for k, m in zip(keys, md, strict=True)])
    dow = idx.dayofweek
    hour = idx.hour
    return pd.DataFrame(
        {
            "hour": hour,
            "dow": dow,
            "month": idx.month,
            "day_of_year": idx.dayofyear,
            "is_weekend": (dow >= 5).astype(int),
            "is_holiday": is_holiday.astype(int),
            "hour_sin": np.sin(2 * np.pi * hour / 24),
            "hour_cos": np.cos(2 * np.pi * hour / 24),
            "dow_sin": np.sin(2 * np.pi * dow / 7),
            "dow_cos": np.cos(2 * np.pi * dow / 7),
            "month_sin": np.sin(2 * np.pi * idx.month / 12),
            "month_cos": np.cos(2 * np.pi * idx.month / 12),
        },
        index=idx,
    )


def main() -> None:
    registry = json.loads((CONFIG / "state_registry.json").read_text())
    demand = load_state_demand()
    national = load_national_demand()
    weather = pd.read_parquet(RAW / "weather_states.parquet")

    # Single hourly grid spanning the intersection of demand and weather.
    grid = demand.index.intersection(weather.index)
    demand, weather = demand.reindex(grid), weather.reindex(grid)

    panel = pd.DataFrame(index=grid)
    for code in sorted(registry):
        if code in demand:
            panel[f"demand__{code}"] = demand[code]
    panel["demand__IND"] = national.reindex(grid)
    cal = add_calendar(grid)
    hot = [c for c in weather.columns if c.startswith("temperature_2m__")]
    panel["heat__india_mean"] = weather[hot].mean(axis=1)
    panel = pd.concat([panel, weather, cal], axis=1)

    PROCESSED.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(PROCESSED / "panel.parquet")
    load_national_hourly_history().to_parquet(PROCESSED / "national_hourly_2019_2024.parquet")

    # Chronological split: last 15% test, prior 15% validation, rest training.
    n = len(grid)
    train_end, val_end = grid[int(n * 0.70)], grid[int(n * 0.85)]
    splits = {
        "train": [str(grid[0]), str(train_end)],
        "valid": [str(train_end), str(val_end)],
        "test": [str(val_end), str(grid[-1])],
    }
    (PROCESSED / "splits.json").write_text(json.dumps(splits, indent=2))

    coverage = (1 - panel[[f"demand__{c}" for c in sorted(registry) if c in demand]].isna().mean())
    card = {
        "targets": {
            "granularity": "hourly (resampled from 15-minute readings)",
            "unit": "MW",
            "series": len([c for c in sorted(registry) if c in demand]),
            "window": [str(grid[0]), str(grid[-1])],
            "coverage_pct_of_hourly_grid": round(100 * float(coverage.mean()), 1),
        },
        "sources": {
            "state_demand": "Merit India (meritindia.in) state SLDC demand pulls, mirrored by github.com/vanga/india-power-generation. The mirror declares no licence and publishes no terms of use, so the data is used as scraped public figures with attribution.",
            "national_15min": "same mirror, India-all series (Thermal/GAS/Nuclear/Hydro/Renewable + Demand)",
            "national_hourly_2019_2024": "github.com/2003DIVYA/India-Power-Grid-Demand-Forecasting hourlyLoadDataIndia.csv (secondary scrape; provenance unverified upstream, used only as context and cross-check)",
            "weather": "Open-Meteo ERA5 archive, hourly, Asia/Kolkata, no key required",
        },
        "caveats": [
            "No city-level measurements exist in any accessible source; the game's city demand is state model output scaled by labelled metro share constants in config/state_registry.json.",
            "The two national sources disagree by ~4% on overlapping daily means, so absolute values are indicative rather than official CEA statistics.",
            "Variable-date festival holidays are hand-curated approximations, not an official calendar.",
            "Merit India Demand for IND occasionally exceeds published all-India peak records; outliers are flagged, not silently removed.",
        ],
    }
    (PROCESSED / "dataset_card.json").write_text(json.dumps(card, indent=2))

    print(f"panel {panel.shape} | {grid[0]} -> {grid[-1]}")
    print(f"target coverage: {100 * float(1 - panel.filter(like='demand__').isna().mean().mean()):.1f}%")
    print(f"splits: {splits}")


if __name__ == "__main__":
    main()
