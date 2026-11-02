# Model selection

Served model: **TFT** (`tft`). Chosen on accuracy *and* weather elasticity, not MAE alone.

Chronological backtest, test window 2026-06-09 → 2026-11-01, pooled over 34 states,
errors in MW after per-state denormalisation. Weather elasticity is the model's response
to a monotone 15 °C → 45 °C ramp on the future covariates at a fixed origin.

| model | test MAE (MW) | test MAPE | PI80 coverage | params | 15→45 °C response |
|---|---|---|---|---|---|
| iTransformer | 307.2 | 5.56% | 82.4% | 175k | +3.2%, non-monotonic |
| **TFT** | 324.1 | 5.84% | 84.8% | 44k | **+35.2%, monotonic** |
| LightGBM (global quantile) | 426.0 | 7.01% | 78.0% (77.8% after rolling band calibration) | — | +32.0%, monotonic |
| PatchTST | 520.2 | 9.25% | 79.2% | 70k | +9.7% |
| persistence at origin | 524.0 | 10.5% | — | — | — |
| weekly naive | 790.7 | 14.4% | — | — | — |

iTransformer wins on error but is the wrong served model: its response to a 30 °C
temperature ramp is noise, so the game's heatwave and temperature controls would move
nothing. TFT is 5% worse on MAE, uses 4× fewer parameters, and has the strongest and
most physically ordered weather response of the four.

LightGBM remains the reference baseline in `lgbm_eval.json`; its intervals need rolling
residual calibration to reach nominal coverage, while TFT's quantile heads are already
at 84.8% for a nominal 80%.

Reproduce: `python src/training/train_lgbm.py`, then
`python src/training/train_deep.py`, then `python scripts/probe_weather.py`.
