/**
 * The prediction itself, shown plainly.
 *
 * One hero on this panel: the predicted MW. Everything else is supporting evidence — the
 * interval, the origin the model was called at, and the covariates it was actually fed —
 * so a reader can trace the number to a specific API call.
 */

import type { ForecastResult } from '@/lib/api';
import { formatClock } from '@/lib/sim';

const mw = (v: number) => Math.round(v).toLocaleString('en-IN');
const num = (v: number | undefined) => (v === undefined || v === null ? '—' : v.toFixed(1));

function Row({ k, v, tone = 'text-ink' }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-label text-ink-dim">{k}</span>
      <span className={`stat text-value ${tone}`}>{v}</span>
    </div>
  );
}

export function PredictionPanel({ result, mult, hour, share, edited }: {
  result?: ForecastResult;
  mult: number;
  hour: number;
  /** Metro share applied to the state-level forecast. */
  share: number;
  /** True once the player has moved a weather slider, as opposed to the boot reading. */
  edited: boolean;
}) {
  if (!result || !result.points.length) {
    return (
      <div className="panel p-4 text-center text-label text-ink-dim">
        no prediction — the model service is not answering /api/forecast
      </div>
    );
  }

  const p = result.points;
  const next = p[0];
  const peak = p.reduce((a, b) => (b.p50MW > a.p50MW ? b : a));
  const median = next.p50MW * share * mult;
  const width = (next.p90MW - next.p10MW) * share * mult;
  const measured = result.weatherUsed ?? {};
  const given = result.weather?.[0];
  const meanTemp = given
    ? result.weather.reduce((a, w) => a + w.temperatureC, 0) / result.weather.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <section className="panel p-3">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">predicted load · +{next.offsetH} h</span>
          <span className="eyebrow text-ink-dim">{result.model}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="stat text-hero font-semibold text-cyan">{mw(median)}</span>
          <span className="text-value text-ink-dim">MW</span>
        </div>
        <div className="stat mt-2 text-value text-amber">
          p10 {mw(next.p10MW * share * mult)} – p90 {mw(next.p90MW * share * mult)}
        </div>
        <div className="mt-1 text-label text-ink-dim">
          80 % interval is {mw(width)} MW wide — {(width / median * 100).toFixed(1)} % of the median
        </div>
      </section>

      <section className="panel flex flex-col gap-1 p-3">
        <div className="eyebrow mb-1">this forecast</div>
        <Row k="origin" v={formatClock(hour)} />
        <Row k="horizon" v={`${result.horizonH} h · q 0.1 / 0.5 / 0.9`} />
        <Row k="peak in window" v={`${mw(peak.p50MW * share * mult)} MW @ ${formatClock(hour + peak.offsetH).slice(11)}`} />
        <Row k="series" v={`${result.stateName} (${result.stateCode})`} />
        <Row k="× metro share" v={`${(share * 100).toFixed(0)} %`} />
        <Row k="scenario multiplier" v={`×${mult.toFixed(3)}`}
          tone={Math.abs(mult - 1) > 0.01 ? 'text-amber' : 'text-ink'} />
      </section>

      <section className="panel flex flex-col gap-1 p-3">
        <div className="eyebrow mb-1">covariates the model was given</div>
        {given ? (
          <>
            <Row k="temperature" v={`${given.temperatureC.toFixed(1)} °C`}
              tone={edited ? 'text-amber' : 'text-ink'} />
            <Row k="humidity" v={`${given.humidityPct.toFixed(0)} %`}
              tone={edited ? 'text-amber' : 'text-ink'} />
            <Row k="irradiance" v={`${given.irradianceWm2.toFixed(0)} W/m²`} />
            <Row k="wind" v={`${given.windKmh.toFixed(1)} km/h`} />
            <Row k="precipitation" v={`${given.precipMm.toFixed(1)} mm`} />
            <Row k="mean temp, 24 h" v={`${meanTemp.toFixed(1)} °C`} />
          </>
        ) : (
          <div className="text-label text-ink-dim">service returned no per-step weather</div>
        )}
        <div className="mt-1 text-label leading-snug text-ink-dim">
          measured at origin: {num(measured.temperature_2m)} °C, {num(measured.relative_humidity_2m)} % RH
          {edited && ' — amber means your scenario replaced the measurement'}
        </div>
        {result.warnings.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1 text-label leading-snug text-amber">
            {result.warnings.map((w) => <li key={w}>! {w}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
