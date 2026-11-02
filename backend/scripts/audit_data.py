"""Audit the raw electricity series before any modelling decision is made.

Reports time coverage, sampling interval, gaps, and unit sanity for each source
so granularity claims in the game UI can be backed by the data.
"""

import sys
from pathlib import Path

import pandas as pd

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"


def summarize(name: str, ts: pd.Series, label: str) -> None:
    span_days = (ts.index.max() - ts.index.min()).days
    print(f"\n=== {name} ===")
    print(f"{label}: {len(ts):,} rows | {ts.index.min()} -> {ts.index.max()} | {span_days} days")
    inferred = pd.infer_freq(ts.index[:200])
    print(f"inferred frequency: {inferred}")
    dupes = ts.index.duplicated().sum()
    print(f"duplicate timestamps: {dupes}")
    print(f"nulls: {int(ts.isna().sum())} ({100 * ts.isna().mean():.2f}%)")
    print("value stats (MW):")
    print(ts.describe().round(1).to_string())
    full = pd.date_range(ts.index.min().floor("D"), ts.index.max().ceil("D"), freq="h")
    coverage = ts.resample("h").size().reindex(full).notna().mean()
    print(f"hourly grid coverage: {100 * coverage:.1f}%")


def main() -> None:
    div = pd.read_csv(RAW / "india_hourly_national.csv")
    div.columns = [c.strip().lstrip("﻿") for c in div.columns]
    div["datetime"] = pd.to_datetime(div["datetime"])
    summarize(
        "DIVYA hourlyLoadDataIndia.csv (national hourly)",
        div.set_index("datetime")["National Hourly Demand"].astype(float),
        "series",
    )
    print("non-monotonic index entries:", int((div["datetime"].diff().dt.total_seconds() < 0).sum()))

    ind = pd.read_csv(RAW / "india_all_15min.csv")
    ind["Datetime"] = pd.to_datetime(ind["Datetime"])
    gen_cols = ["Thermal", "GAS", "Nuclear", "Hydro", "Renewable"]
    for c in ["Demand", *gen_cols]:
        ind[c] = pd.to_numeric(ind[c].astype(str).str.replace(",", ""), errors="coerce")
    summarize("vanga/meritindia India-all (national 15-min demand)",
              ind.set_index("Datetime")["Demand"], "demand")
    for c in gen_cols:
        print(f"{c}: nulls={int(ind[c].isna().sum())} mean={ind[c].mean():.0f} max={ind[c].max():.0f}")

    print("\n=== sum-of-components check (Demand vs Thermal+GAS+Nuclear+Hydro+Renewable) ===")
    comp = ind[gen_cols].sum(axis=1)
    err = (comp - ind["Demand"]) / ind["Demand"]
    print(f"median abs relative error: {err.abs().median():.4f} | p95: {err.abs().quantile(.95):.4f}")

    print("\n=== consistency cross-check ===")
    a = div.set_index("datetime")["National Hourly Demand"].resample("D").mean()
    b = ind.set_index("Datetime")["Demand"].resample("D").mean()
    common = a.index.intersection(b.index)
    print(f"overlapping days: {len(common)}")
    if len(common):
        ratio = (a.loc[common] / b.loc[common]).dropna()
        print(f"daily-mean ratio DIVYA/Merit: median={ratio.median():.3f} p5={ratio.quantile(.05):.3f} p95={ratio.quantile(.95):.3f}")
        print(f"DIVYA daily mean in overlap: {a.loc[common].mean():.0f} MW | Merit: {b.loc[common].mean():.0f} MW")

    print("\n=== state-level 15-min panel ===")
    files = sorted((RAW / "state_15min").glob("*.csv"))
    print(f"files: {len(files)}")
    frames = []
    for f in files[:4]:
        d = pd.read_csv(f)
        frames.append(d)
    st = pd.concat(frames, ignore_index=True)
    st["Datetime"] = pd.to_datetime(st["Datetime"])
    st["Demand"] = pd.to_numeric(st["Demand"].astype(str).str.replace(",", ""), errors="coerce")
    print(f"states present: {st['StateCode'].nunique()} -> {sorted(st['StateCode'].unique())}")
    piv = st.pivot_table(index="Datetime", columns="StateCode", values="Demand", aggfunc="mean")
    print(f"window: {piv.index.min()} -> {piv.index.max()} | rows={len(piv):,}")
    print(f"null share per state (first 4 months):")
    print((piv.isna().mean() * 100).round(1).to_string())
    print("national sum median:", f"{piv.sum(axis=1, min_count=1).median():.0f} MW vs India-all median {b.median():.0f} MW")


if __name__ == "__main__":
    sys.exit(main())
