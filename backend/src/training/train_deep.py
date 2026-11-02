"""Train and chronologically evaluate the deep forecasters against the GBM baseline.

Same split, same normalisation, same metrics as train_lgbm.py, so a win here is a real
win and not a difference in bookkeeping. Selection is on validation MAE in MW; the test
window is touched once per model.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from models.common import PanelBundle, report_metrics, state_scales  # noqa: E402
from models.deep.dataset import (EVAL_HORIZONS, WindowDataset,  # noqa: E402
                                 build_windows, weather_stats)
from models.deep.nets import MODELS, pinball_loss  # noqa: E402

ARTIFACTS = ROOT / "artifacts"
RESULTS = ARTIFACTS / "results"
CHECKPOINTS = ARTIFACTS / "models" / "deep"


def make_sets(bundle: PanelBundle, stride_train: int, stride_eval: int):
    panel, states = bundle.panel, bundle.states
    scales = state_scales(bundle)
    tr_lo, tr_hi = bundle.splits["train"]
    stats = weather_stats(panel, states, tr_lo, tr_hi)
    out = {}
    for name, (lo, hi), stride in (("train", bundle.splits["train"], stride_train),
                                   ("valid", bundle.splits["valid"], stride_eval),
                                   ("test", bundle.splits["test"], stride_eval)):
        blocks = [build_windows(panel, s, scales, stats[s], lo, hi, stride=stride)
                  for s in states]
        blocks = [b for b in blocks if len(b["y"])]
        out[name] = WindowDataset(blocks)
        print(f"{name}: {len(out[name]):,} windows", flush=True)
    return out, scales


def predict(model: torch.nn.Module, ds: WindowDataset, batch: int) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    outs, meds = [], []
    with torch.no_grad():
        for xp, xk, _ in DataLoader(ds, batch_size=batch, num_workers=0):
            q = model(xp, xk).cpu().numpy()          # (B,3,H)
            outs.append(q)
            meds.append(q[:, 1])
    return np.concatenate(outs), np.concatenate(meds)


def evaluate(ds: WindowDataset, q: np.ndarray, scales: dict, label: str) -> dict:
    """Metrics in MW, pooled and per horizon, plus raw 80% interval coverage."""
    scale = np.array([scales[s] for s in ds.state], dtype=np.float32)
    y_mw = ds.y * scale[:, None]
    pred_mw = q * scale[:, None, None]
    med_mw, lo_mw, hi_mw = pred_mw[:, 1], pred_mw[:, 0], pred_mw[:, 2]

    overall = report_metrics(y_mw.ravel(), med_mw.ravel(), lo_mw.ravel(), hi_mw.ravel())
    per_h = {}
    for h in EVAL_HORIZONS:
        col = h - 1
        per_h[f"h{h}"] = report_metrics(y_mw[:, col], med_mw[:, col],
                                        lo_mw[:, col], hi_mw[:, col])
        per_h[f"h{h}"]["n"] = int(y_mw.shape[0])
    per_state = {}
    for s in sorted(set(ds.state)):
        m = ds.state == s
        per_state[s] = report_metrics(y_mw[m].ravel(), med_mw[m].ravel(),
                                      lo_mw[m].ravel(), hi_mw[m].ravel())
        per_state[s]["n"] = int(m.sum())
    return {"model": label, "overall": overall, "per_horizon": per_h, "per_state": per_state}


def train_one(name: str, ds, scales: dict, epochs: int, batch: int, lr: float,
              device: str) -> tuple[object, dict, float]:
    model = MODELS[name]().to(device)
    n_params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loader = DataLoader(ds["train"], batch_size=batch, shuffle=True, num_workers=0)
    best = {"mae": float("inf"), "epoch": 0, "state": None}
    t0 = time.time()

    for epoch in range(epochs):
        model.train()
        total = 0.0
        for xp, xk, y in loader:
            xp, xk, y = xp.to(device), xk.to(device), y.to(device)
            opt.zero_grad(set_to_none=True)
            loss = pinball_loss(y, model(xp, xk))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += float(loss.item()) * len(y)
        sched.step()

        _, med_valid = predict(model, ds["valid"], batch)
        scale = np.array([scales[s] for s in ds["valid"].state], dtype=np.float32)
        mae = float(np.mean(np.abs((ds["valid"].y - med_valid) * scale[:, None]).ravel()))
        print(f"  [{name}] epoch {epoch + 1}/{epochs} train_loss={total / len(ds['train']):.5f} "
              f"valid_MAE_MW={mae:.1f}", flush=True)
        if mae < best["mae"]:
            best = {"mae": mae, "epoch": epoch + 1,
                    "state": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}}

    model.load_state_dict(best["state"])
    secs = time.time() - t0
    meta = {"name": name, "params": n_params, "best_epoch": best["epoch"],
            "valid_MAE_MW": round(best["mae"], 1), "train_seconds": round(secs, 1)}
    return model, meta, secs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="patchtst,itransformer,tft")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--stride-train", type=int, default=6)
    ap.add_argument("--stride-eval", type=int, default=6)
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args()

    torch.set_num_threads(8)
    bundle = PanelBundle.load()
    ds, scales = make_sets(bundle, a.stride_train, a.stride_eval)

    baseline = {}
    lgbm_path = RESULTS / "lgbm_eval.json"
    if lgbm_path.exists():
        b = json.loads(lgbm_path.read_text())
        baseline["lightgbm"] = b["overall"] | {"per_horizon": b["per_horizon"]}

    results = {"baseline": baseline, "models": {}}
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    for name in [m.strip() for m in a.models.split(",") if m.strip()]:
        print(f"\n=== {name} ===", flush=True)
        model, meta, _ = train_one(name, ds, scales, a.epochs, a.batch, a.lr, a.device)
        q, _ = predict(model, ds["test"], a.batch)
        ev = evaluate(ds["test"], q, scales, name)
        ev["meta"] = meta
        results["models"][name] = ev
        torch.save({"state_dict": model.state_dict(), "meta": meta},
                   CHECKPOINTS / f"{name}.pt")

    ranked = sorted(results["models"].items(), key=lambda kv: kv[1]["overall"]["MAE_MW"])
    results["ranking"] = [{"model": k, "MAE_MW": v["overall"]["MAE_MW"],
                           "MAPE_pct": v["overall"]["MAPE_pct"],
                           "PI80_coverage_pct": v["overall"]["PI80_coverage_pct"]}
                          for k, v in ranked]
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "deep_eval.json").write_text(json.dumps(results, indent=2))
    print("\n=== ranking (test) ===")
    print(json.dumps(results["ranking"], indent=2))
    if baseline:
        print("lightgbm baseline:", json.dumps(
            {k: v for k, v in baseline["lightgbm"].items() if k != "per_horizon"}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
