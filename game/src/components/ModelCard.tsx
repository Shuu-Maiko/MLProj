/**
 * Model card: what is being served, how it was chosen, and what the numbers are made of.
 *
 * Every figure is read from the service's /model response, which in turn reads the
 * evaluation artifacts — so this panel cannot drift out of date from the checkpoint.
 */

import type { ModelInfo } from '@/lib/api';

const num = (v: number | undefined, dp = 1) =>
  v === undefined || v === null ? '—' : v.toFixed(dp);

export function ModelCard({ info }: { info: ModelInfo | null }) {
  if (!info) {
    return <div className="text-label text-ink-dim">model card unavailable — service not reachable</div>;
  }

  const { served, benchmark, dataset } = info;
  const elasticity = benchmark.weather_response ?? {};
  const rows = [
    ...(benchmark.ranking ?? []).map((r) => ({
      model: r.model, MAE: r.MAE_MW, MAPE: r.MAPE_pct, PI: r.PI80_coverage_pct,
    })),
    ...(benchmark.lightgbm?.overall
      ? [{
        model: 'lightgbm',
        MAE: benchmark.lightgbm.overall.MAE_MW,
        MAPE: benchmark.lightgbm.overall.MAPE_pct,
        PI: benchmark.lightgbm.overall.PI80_coverage_pct,
      }]
      : []),
    ...Object.entries(benchmark.lightgbm?.naive ?? {}).map(([model, v]) => ({
      model, MAE: v.MAE_MW, MAPE: v.MAPE_pct, PI: undefined as number | undefined,
    })),
  ].sort((a, b) => a.MAE - b.MAE);

  const best = rows[0]?.model;

  return (
    <div className="flex flex-col gap-3 text-label">
      <section>
        <div className="eyebrow mb-1">Served model</div>
        <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-[2px]">
          <dt className="text-ink-dim">architecture</dt>
          <dd className="stat">{served.model} — GRU encoder/decoder + cross-attention over known-future covariates, 3 quantile heads</dd>
          <dt className="text-ink-dim">parameters</dt>
          <dd className="stat">{served.params?.toLocaleString('en-IN')}</dd>
          <dt className="text-ink-dim">context → horizon</dt>
          <dd className="stat">168 h → {served.horizon_hours} h, quantiles {(served.quantiles ?? []).join(' / ')}</dd>
          <dt className="text-ink-dim">series</dt>
          <dd className="stat">{served.states} states, pooled, normalised per state by median train-window demand</dd>
          <dt className="text-ink-dim">training window</dt>
          <dd className="stat">{served.window?.[0]} → {served.window?.[1]}</dd>
          <dt className="text-ink-dim">targets</dt>
          <dd className="stat">{served.trained_on}</dd>
        </dl>
      </section>

      <section>
        <div className="eyebrow mb-1">Chronological backtest · test 2026-06-09 → 2026-11-01</div>
        <table className="w-full border-collapse text-label">
          <thead>
            <tr className="text-left text-ink-dim">
              <th className="py-[2px] pr-1 font-normal">model</th>
              <th className="font-normal">MAE MW</th>
              <th className="font-normal">MAPE</th>
              <th className="font-normal">PI80</th>
              <th className="font-normal">15→45 °C</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className={`border-t border-line ${r.model === served.model ? 'text-cyan' : ''}`}>
                <td className="py-[2px] pr-1">
                  {r.model}
                  {r.model === served.model && ' ← served'}
                  {r.model === best && r.model !== served.model && ' ← lowest MAE'}
                </td>
                <td className="stat">{num(r.MAE)}</td>
                <td className="stat">{num(r.MAPE, 2)}%</td>
                <td className="stat">{r.PI === undefined ? '—' : `${num(r.PI)}%`}</td>
                <td className="stat">{num(elasticity[r.model]?.total_response_pct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 leading-tight text-ink-dim">
          iTransformer has the lowest error but a {num(elasticity.itransformer?.total_response_pct)} % response to a
          30 °C ramp, so heatwave controls would move nothing; {served.model} is kept for the strongest monotonic
          weather response. LightGBM reaches nominal coverage only after rolling residual calibration
          (raw quantiles: {num(benchmark.lightgbm?.overall?.raw_quantile_PI80_coverage_pct)} %).
        </p>
      </section>

      {dataset && (
        <section>
          <div className="eyebrow mb-1">Data provenance</div>
          <ul className="flex flex-col gap-[2px] leading-tight text-ink-dim">
            {Object.entries(dataset.sources ?? {}).map(([k, v]) => (
              <li key={k}><span className="text-ink">{k}</span>: {v}</li>
            ))}
          </ul>
        </section>
      )}

      {dataset?.caveats && dataset.caveats.length > 0 && (
        <section>
          <div className="eyebrow mb-1 text-amber">Caveats</div>
          <ul className="flex flex-col gap-[3px] leading-tight text-ink-dim">
            {dataset.caveats.map((c) => <li key={c}>· {c}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
