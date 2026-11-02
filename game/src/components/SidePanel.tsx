/**
 * Right-hand panel.
 *
 * Ordered by what matters: which city you are reading, the prediction, the levers that
 * change it, then the curve. The demand-driver sliders are folded away because they
 * reshape the calibration multiplier, not the model's forecast.
 */

import { ForecastChart } from './ForecastChart';
import { PredictionPanel } from './PredictionPanel';
import type { ForecastResult } from '@/lib/api';
import type { CityLoad } from '@/lib/sim';
import type { City, CityParams, Selection } from '@/lib/types';

const nf = (v: number, dp = 0) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });

type Field = {
  key: keyof CityParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

/** Sent to the service as scenario covariates, so the model's own output moves. */
const COVARIATES: Field[] = [
  { key: 'temperatureC', label: 'Temperature', min: 5, max: 48, step: 0.5, format: (v) => `${v.toFixed(1)} °C` },
  { key: 'humidityPct', label: 'Humidity', min: 15, max: 96, step: 1, format: (v) => `${Math.round(v)} %` },
];

/** Reshape the load index only; the forecast level is unaffected by these. */
const DRIVERS: Field[] = [
  { key: 'population', label: 'Population', min: 400_000, max: 40_000_000, step: 50_000, format: (v) => nf(v / 1e6, 2) + ' M' },
  { key: 'households', label: 'Households', min: 120_000, max: 12_000_000, step: 10_000, format: (v) => nf(v / 1e6, 2) + ' M' },
  { key: 'perCapitaKWh', label: 'Per-capita kWh/yr', min: 150, max: 3_200, step: 10, format: (v) => nf(v) + ' kWh' },
  { key: 'industrialActivity', label: 'Industrial activity', min: 0.2, max: 2.5, step: 0.05, format: (v) => `×${v.toFixed(2)}` },
  { key: 'commercialActivity', label: 'Commercial activity', min: 0.2, max: 2.5, step: 0.05, format: (v) => `×${v.toFixed(2)}` },
  { key: 'evPenetration', label: 'EV penetration', min: 0, max: 0.6, step: 0.01, format: (v) => `${(v * 100).toFixed(1)} %` },
  { key: 'solarCapacityMW', label: 'Rooftop solar', min: 0, max: 4_000, step: 20, format: (v) => `${nf(v)} MW` },
  { key: 'efficiency', label: 'Efficiency', min: 0.5, max: 1.6, step: 0.01, format: (v) => `×${v.toFixed(2)}` },
];

export function CityTabs({ cities, selection, onSelect }: {
  cities: City[];
  selection: Selection;
  onSelect: (sel: Selection) => void;
}) {
  return (
    <div className="flex gap-1">
      {cities.map((c) => (
        <button key={c.id} className="btn flex-1 justify-center"
          data-on={selection?.kind === 'city' && selection.id === c.id}
          onClick={() => onSelect({ kind: 'city', id: c.id })}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

function Slider({ field, city, onEdit }: {
  field: Field; city: City; onEdit: (patch: Partial<CityParams>) => void;
}) {
  const value = city.params[field.key];
  const base = city.baseline[field.key];
  const changed = Math.abs(value - base) > field.step / 2;

  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className={`text-label ${changed ? 'text-amber' : 'text-ink-dim'}`}>{field.label}</span>
        <span className="stat text-value">
          {field.format(value)}
          {changed && <span className="ml-2 text-label text-ink-dim">was {field.format(base)}</span>}
        </span>
      </div>
      <input
        type="range"
        className="mt-1"
        min={field.min}
        max={field.max}
        step={field.step}
        aria-label={field.label}
        value={value}
        onChange={(e) => onEdit({ [field.key]: Number(e.target.value) } as Partial<CityParams>)}
      />
    </label>
  );
}

function Stat({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-label text-ink-dim">{label}</span>
      <span className={`stat text-value truncate ${tone}`}>{value}</span>
    </div>
  );
}

export function CityPanel({ city, load, result, hour, modelLabel, weatherEdited, onEdit, onReset }: {
  city: City;
  load?: CityLoad;
  result?: ForecastResult;
  hour: number;
  modelLabel: string;
  weatherEdited: boolean;
  onEdit: (patch: Partial<CityParams>) => void;
  onReset: () => void;
}) {
  const stress = load ? load.netMW / city.capacityFirmMW : 0;
  const stressTone = stress > 1 ? 'text-danger' : stress > 0.85 ? 'text-amber' : 'text-ok';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-title font-semibold leading-tight">{city.name}</div>
          <div className="text-label leading-tight text-ink-dim">
            {city.stateName} series × {(city.metroShare * 100).toFixed(0)} % metro share
          </div>
        </div>
        <button className="btn" onClick={onReset}>Reset</button>
      </div>

      <PredictionPanel result={result} mult={load?.scenarioMult ?? 1} hour={hour} share={city.metroShare} edited={weatherEdited} />

      <section className="panel flex flex-col gap-2 p-3">
        <div className="eyebrow">model covariates · re-forecasts on change</div>
        {COVARIATES.map((f) => <Slider key={f.key} field={f} city={city} onEdit={onEdit} />)}
        {weatherEdited && (
          <div className="text-label leading-snug text-amber">
            Weather overridden — you are asking the model for a day that is not the forecast one.
          </div>
        )}
      </section>

      <section className="panel p-3">
        <div className="eyebrow mb-2">forecast vs measured · {modelLabel}</div>
        <ForecastChart city={city} result={result} mult={load?.scenarioMult ?? 1}
          share={city.metroShare} hour={hour} modelLabel={modelLabel} />
      </section>

      <section className="panel grid grid-cols-2 gap-x-4 gap-y-1 p-3">
        <Stat label="simulated now" value={load ? `${nf(load.netMW)} MW` : '—'} />
        <Stat label="vs firm capacity" value={`${(stress * 100).toFixed(0)} %`} tone={stressTone} />
        <Stat label="cooling share" value={load ? `${(load.coolingShare * 100).toFixed(1)} %` : '—'} />
        <Stat label="firm capacity" value={`${nf(city.capacityFirmMW)} MW`} />
      </section>

      <details className="panel p-3">
        <summary>Demand drivers — calibration only</summary>
        <div className="mt-2 flex flex-col gap-2">
          {DRIVERS.map((f) => <Slider key={f.key} field={f} city={city} onEdit={onEdit} />)}
        </div>
      </details>

      <p className="px-1 text-label leading-snug text-ink-dim">
        The MW level is the trained model&rsquo;s forecast of {city.stateName}&rsquo;s measured load; these
        sliders reshape it as a ratio. No city-level measurements exist in the sources used.
      </p>
    </div>
  );
}

export function InfoPanel({ cities, onSelect }: { cities: City[]; onSelect: (sel: Selection) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-title font-semibold">Pick a city</div>
      <p className="text-label leading-snug text-ink-dim">
        Select a district above or click one on the map to read the model&rsquo;s forecast for it and
        edit its scenario.
      </p>
      <div className="flex flex-col gap-1">
        {cities.map((c) => (
          <button key={c.id} className="btn justify-between" onClick={() => onSelect({ kind: 'city', id: c.id })}>
            <span>{c.name}</span>
            <span className="stat text-label text-ink-dim">
              {nf(c.params.population / 1e6, 2)} M · {c.params.temperatureC.toFixed(1)} °C
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
