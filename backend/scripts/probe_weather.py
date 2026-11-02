"""Measure how much each candidate model actually responds to weather.

Accuracy alone is the wrong selection criterion for this game: a heatwave that does not
move the forecast is a broken feature, however good the MAE. This probes a monotone
temperature ramp on every served candidate and on the LightGBM baseline.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from api.inference import Forecaster  # noqa: E402
from models.common import PanelBundle, build_supervised  # noqa: E402

RESULTS = ROOT / "artifacts" / "results"
STATE = "DL"
ORIGIN = pd.Timestamp("2026-04-15T12:00:00")  # hot-season afternoon
TEMPS = [15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0]


def probe_deep(model: str) -> dict[str, float]:
    f = Forecaster(model=model)
    real = float(f.panel[f"temperature_2m__{STATE}"].loc[:ORIGIN].iloc[-1])
    out = {}
    for t in TEMPS:
        df = f.forecast(STATE, int((ORIGIN - f.timestamp(0)).total_seconds() // 3600) - 12,
                        24, {"temperature_c": t})
        out[f"{t:.0f}C"] = round(float(df.points.p50MW.mean()), 1)
    out["_real_temp"] = round(real, 1)
    return out


def probe_lgbm() -> dict[str, float]:
    import lightgbm as lgb

    meta = json.loads((ROOT / "artifacts/models/lgbm/metadata.json").read_text())
    feats = meta["features"] + ["state_code"]
    boosters = {a: lgb.Booster(model_str=(ROOT / f"artifacts/models/lgbm/quantile_{str(a).replace('.', '_')}.txt").read_text())
                for a in (0.1, 0.5, 0.9)}
    bundle = PanelBundle.load()
    df = build_supervised(bundle, states=[STATE], horizons=(12,))
    rows = df[(df["origin"] == ORIGIN)].copy()
    if rows.empty:
        return {}
    scale = float(rows["scale_MW"].iloc[0])
    out = {}
    for t in TEMPS:
        r = rows.copy()
        r["w_fut_temperature_2m"] = t
        r["w_org_temperature_2m"] = t
        r["w_fut_apparent_temperature"] = t + 4.0
        x = np.column_stack([r[c].to_numpy(np.float32) for c in meta["features"]]
                            + [np.full(len(r), meta["state_mapping"][STATE], np.float32)])
        out[f"{t:.0f}C"] = round(float(boosters[0.5].predict(x).mean() * scale), 1)
    out["_real_temp"] = round(float(rows["w_fut_temperature_2m"].iloc[0]), 1)
    return out


def spread(vals: dict[str, float]) -> float:
    numbers = [v for k, v in vals.items() if k.endswith("C")]
    lo, hi = min(numbers), max(numbers)
    return round(100 * (hi - lo) / lo, 2)


def main() -> int:
    report = {}
    for model in ("itransformer", "tft", "patchtst"):
        report[model] = probe_deep(model)
        print(f"{model}: {report[model]}")
    report["lightgbm"] = probe_lgbm()
    print(f"lightgbm: {report['lightgbm']}")

    summary = {k: {"sweep": v, "total_response_pct": spread(v)} for k, v in report.items() if v}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "weather_response.json").write_text(json.dumps(summary, indent=2))
    print("\ntotal response across 15C -> 45C:")
    for k, v in summary.items():
        print(f"  {k:14s} {v['total_response_pct']:+.2f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
