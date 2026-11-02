"""Global LightGBM baseline: one pooled model per quantile across all states/horizons.

Quantile objectives (10/50/90) give prediction intervals without a separate model,
and the 50th-percentile prediction doubles as the point forecast so the interval and
the median cannot disagree.
"""

from __future__ import annotations

import json
import pathlib
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from models.common import (HORIZONS, STATE_FEATURE, PanelBundle, build_supervised,  # noqa: E402
                           feature_columns, pinball, report_metrics, split_mask,
                           state_mapping, state_scales, to_matrix)

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODELS = ROOT / "artifacts" / "models" / "lgbm"
RESULTS = ROOT / "artifacts" / "results"
ALPHAS = (0.1, 0.5, 0.9)

PARAMS = {
    "objective": "regression",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "max_bin": 127,
    "min_data_in_leaf": 300,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
    "n_jobs": 8,
    "seed": 7,
}


def train_one(X_tr: np.ndarray, y_tr: np.ndarray, X_va: np.ndarray, y_va: np.ndarray,
              feats: list[str], alpha: float) -> lgb.Booster:
    p = dict(PARAMS)
    if alpha != 0.5:
        p["objective"] = "quantile"
        p["alpha"] = alpha
    names = feats + [STATE_FEATURE]
    dtrain = lgb.Dataset(X_tr, label=y_tr, feature_name=names,
                        categorical_feature=[STATE_FEATURE])
    dvalid = lgb.Dataset(X_va, label=y_va, feature_name=names,
                         categorical_feature=[STATE_FEATURE], reference=dtrain)
    return lgb.train(p, dtrain, num_boost_round=900, valid_sets=[dvalid],
                     callbacks=[lgb.early_stopping(50, verbose=False)])


def naive_baseline(mask: np.ndarray, meta: pd.DataFrame, col: str, y_norm: np.ndarray,
                   scale: np.ndarray) -> dict:
    """Naive reference in MW. `y_norm` is the normalised target, so both sides are
    rescaled by the same per-row factor before comparison."""
    p = meta[col].to_numpy()[mask] * scale[mask]
    keep = ~np.isnan(p)
    return report_metrics((y_norm[mask] * scale[mask])[keep], p[keep])


def rolling_residual_band(target_time: np.ndarray, state: np.ndarray, horizon: np.ndarray,
                          residual: np.ndarray, include: np.ndarray, window: int = 1500,
                          every: int = 25, min_count: int = 200,
                          nominal: float = 0.80) -> tuple[np.ndarray, np.ndarray, dict]:
    """Adaptive per-(state, horizon) residual quantiles in normalised units.

    Why not a static band: a single quantile pair fitted on the validation window
    covers only 68% of the later test window, because error scale tracks the summer
    peak season. Rows are processed in target order and a band may only use residuals
    whose target already realised, so scoring stays honest, and the last band per group
    is what the serving layer ships.
    """
    df = pd.DataFrame({"target_time": target_time, "state": state, "horizon": horizon,
                       "residual": residual, "include": include})
    df = df[df["include"]].sort_values("target_time")
    lo = np.zeros(len(target_time), dtype=np.float32)
    hi = np.zeros(len(target_time), dtype=np.float32)
    q_lo, q_hi = (1 - nominal) / 2, (1 + nominal) / 2
    final: dict[str, dict[str, float]] = {}
    for (st, h), g in df.groupby(["state", "horizon"], sort=False):
        r = g["residual"].to_numpy()
        pos = g.index.to_numpy()
        for start in range(0, len(r), every):
            stop = min(start + every, len(r))
            buf = r[max(0, start - window):start]
            if len(buf) >= min_count:
                b_lo, b_hi = float(np.quantile(buf, q_lo)), float(np.quantile(buf, q_hi))
                final[f"{st}|{int(h)}"] = {"lo": round(b_lo, 5), "hi": round(b_hi, 5)}
            else:
                b_lo = b_hi = 0.0  # warm-up: band collapses to the median
            lo[pos[start:stop]], hi[pos[start:stop]] = b_lo, b_hi
    return lo, hi, final


def main() -> int:
    bundle = PanelBundle.load()
    df = build_supervised(bundle)
    # LightGBM routes NaN to a default branch, so sparse-by-design columns stay in as
    # long as most rows carry a value. Requiring notna().all() here previously dropped
    # every demand-lag feature and cost most of the model's skill.
    coverage = df[feature_columns(df)].notna().mean()
    feats = [c for c in feature_columns(df) if coverage[c] > 0.5]
    print(f"rows={len(df):,} numeric_features={len(feats)}", flush=True)

    smap = state_mapping(df)
    X = to_matrix(df, feats, smap)
    y = df["y"].to_numpy(np.float32)  # normalised target
    scale = df["scale_MW"].to_numpy(np.float32)
    meta = df[["origin", "target_time", "state", "horizon",
               "lag_at_origin", "lag_168h"]].reset_index(drop=True)
    del df
    m_tr, m_va, m_te = (split_mask(meta, s, bundle.splits) for s in ("train", "valid", "test"))
    # Train on alternating weeks: halves the design matrix on this 14 GB box while
    # keeping every hour, weekday and season represented. Striding by hour instead
    # would leave the model untrained on odd hours.
    weeks = meta["origin"].dt.isocalendar().week.to_numpy()
    m_tr = m_tr & (weeks % 2 == 0)

    print(f"train={m_tr.sum():,} valid={m_va.sum():,} test={m_te.sum():,}", flush=True)
    boosters = {}
    for a in ALPHAS:
        boosters[a] = train_one(X[m_tr], y[m_tr], X[m_va], y[m_va], feats, a)
        print(f"alpha={a} rounds={boosters[a].best_iteration}", flush=True)

    # Predict over the full matrix once so every mask below shares one index space.
    preds = {a: boosters[a].predict(X) for a in ALPHAS}
    h_all = meta["horizon"].to_numpy()
    s_all = meta["state"].astype(str).to_numpy()
    # Calibrate on the out-of-sample residual stream (valid then test); train
    # residuals are in-sample and would give an optimistically narrow band.
    lo_off, hi_off, band = rolling_residual_band(
        meta["target_time"].to_numpy(), s_all, h_all, y - preds[0.5], m_va | m_te)
    # Back into MW for everything the report and the game show.
    y_mw, med_mw = y * scale, preds[0.5] * scale
    lo_mw, hi_mw = (preds[0.5] + lo_off) * scale, (preds[0.5] + hi_off) * scale
    raw_lo_mw, raw_hi_mw = preds[0.1] * scale, preds[0.9] * scale

    y_te, med_te = y_mw[m_te], med_mw[m_te]
    overall = report_metrics(y_te, med_te, lo_mw[m_te], hi_mw[m_te])
    overall["raw_quantile_PI80_coverage_pct"] = report_metrics(
        y_te, med_te, raw_lo_mw[m_te], raw_hi_mw[m_te])["PI80_coverage_pct"]
    overall["pinball_MW"] = {f"q{str(a).replace('.', '')}": round(
        pinball(y_te, (preds[a] * scale)[m_te], a), 2) for a in ALPHAS}
    per_h = {}
    for h in HORIZONS:
        hm = (h_all == float(h)) & m_te
        per_h[f"h{h}"] = {"n": int(hm.sum()),
                          **report_metrics(y_mw[hm], med_mw[hm], lo_mw[hm], hi_mw[hm])}
    naive = {k: naive_baseline(m_te, meta, k, y, scale)
             for k in ("lag_at_origin", "lag_168h")}
    gain = {k: round(100 * (1 - overall["MAE_MW"] / v["MAE_MW"]), 1)
            for k, v in naive.items() if v["MAE_MW"] > 0}

    # Per-state error: the game surfaces this as city-level forecast confidence.
    per_state = {}
    for state in meta["state"].cat.categories:
        sm = (meta["state"] == state).to_numpy() & m_te
        if sm.sum() > 100:
            per_state[str(state)] = {"n": int(sm.sum()),
                                     **report_metrics(y_mw[sm], med_mw[sm],
                                                      lo_mw[sm], hi_mw[sm])}

    metrics = {"model": "lightgbm_global_quantile", "n_test": int(m_te.sum()),
               "target_space": "per-state normalised, reported in MW",
               "overall": overall, "per_horizon": per_h, "per_state": per_state,
               "residual_band_normalised": band,
               "naive": {"persistence_at_origin": naive["lag_at_origin"],
                         "weekly_naive": naive["lag_168h"]},
               "mae_reduction_vs_naive_pct": {"persistence": gain["lag_at_origin"],
                                              "weekly_naive": gain["lag_168h"]}}

    MODELS.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    for a, b in boosters.items():
        b.save_model(str(MODELS / f"quantile_{str(a).replace('.', '_')}.txt"))
    (MODELS / "metadata.json").write_text(json.dumps(
        {"features": feats, "state_mapping": smap, "horizons": list(HORIZONS),
         "alphas": list(ALPHAS), "residual_band_normalised": band,
         "state_scales_MW": {k: round(v, 1) for k, v in state_scales(bundle).items()}}, indent=2))
    detail = meta[m_te].copy()
    detail["y_MW"] = y_te
    detail["pred_MW"] = med_te
    detail["pi_lo_MW"] = lo_mw[m_te]
    detail["pi_hi_MW"] = hi_mw[m_te]
    detail.to_parquet(RESULTS / "lgbm_test_predictions.parquet")
    (RESULTS / "lgbm_eval.json").write_text(json.dumps(metrics, indent=2))
    hide = {"per_state", "residual_band_normalised"}
    print(json.dumps({k: v for k, v in metrics.items() if k not in hide}, indent=2))

    imp = pd.Series(boosters[0.5].feature_importance("gain"),
                    index=feats + [STATE_FEATURE]).sort_values(ascending=False)
    print("\ntop features by gain:")
    print(imp.head(12).round(0).to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
