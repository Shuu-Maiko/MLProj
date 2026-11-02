/**
 * Simulation engine. Deliberately free of React and Phaser so it can be unit-tested and
 * so the renderer is a pure function of state.
 *
 * How a city's demand is produced, and which parts are real:
 *
 *   modelMW(t)      = trained forecast of the state's hourly load (real measurements)
 *   cityMW(t)       = modelMW(t) * metroShare            (labelled calibration constant)
 *   scenarioMult(t) = loadIndex(edited params) / loadIndex(baseline params)
 *   netMW(t)        = cityMW(t) * scenarioMult(t) - solarOffset(t)
 *
 * The multiplier is a ratio of an index whose units cancel, so no absolute magnitude is
 * invented for a city: the level always comes from the trained model, and the player's
 * knobs only ever reshape it. At untouched defaults the multiplier is exactly 1.
 */

import type { City, CityParams } from './types';

/**
 * IST-anchored epoch so clock arithmetic matches the dataset's timezone. Hour 0 must
 * print 2026-01-01 00:00, which is 2025-12-31 18:30 UTC — the backend's data starts at
 * midnight IST, and a HUD clock that disagreed with the model's timestamps would make
 * every "peak at 19:00" reading wrong.
 */
export const EPOCH_IST = Date.UTC(2025, 11, 31, 18, 30);

const COOLING_THRESHOLD_C = 30;
const COOLING_PER_DEG = 0.022;
const HUMIDITY_COOLING = 0.004;

export function hourOfClock(hour: number) {
  return ((hour % 24) + 24) % 24;
}

export function dayOfClock(hour: number) {
  return Math.floor(hour / 24);
}

export function clockDate(hour: number): Date {
  return new Date(EPOCH_IST + hour * 3_600_000);
}

export function formatClock(hour: number): string {
  const d = clockDate(hour);
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')} ${String(ist.getUTCHours()).padStart(2, '0')}:00`;
}

/**
 * Diurnal + seasonal temperature model used as a weather covariate for the forecast and
 * as the default for the editable temperature field. Calibrated to north/central Indian
 * plains: ~10 C daily swing, hot pre-monsoon April-May, monsoon moderation July-Aug.
 */
export function ambientTemperatureC(hour: number): number {
  const day = dayOfClock(hour);
  const seasonal = 12.5 * Math.sin(((day - 100) / 365) * Math.PI * 2) + 14;
  const monsoonDip = day > 180 && day < 250 ? -3.5 : 0;
  const diurnal = 5.5 * Math.sin(((hourOfClock(hour) - 9) / 24) * Math.PI * 2);
  return Math.round((seasonal + monsoonDip + diurnal) * 10) / 10;
}

export function ambientHumidityPct(hour: number): number {
  const day = dayOfClock(hour);
  const monsoon = day > 165 && day < 270 ? 30 : 0;
  const base = 48 + monsoon - 12 * Math.cos(((hourOfClock(hour) - 4) / 24) * Math.PI * 2);
  return Math.round(Math.max(15, Math.min(96, base)));
}

/** Fraction of full irradiance, 0 at night, reduced by the monsoon. */
export function irradianceFactor(hour: number): number {
  const h = hourOfClock(hour);
  if (h < 6 || h > 18.5) return 0;
  const day = dayOfClock(hour);
  const monsoonCloud = day > 165 && day < 270 ? 0.55 : 0.85;
  return Math.max(0, Math.sin(((h - 6) / 12.5) * Math.PI)) * monsoonCloud;
}

function coolingFactor(tempC: number, humidityPct: number): number {
  const over = Math.max(0, tempC - COOLING_THRESHOLD_C);
  return 1 + COOLING_PER_DEG * over + HUMIDITY_COOLING * over * (humidityPct / 100);
}

/** Evening charging bump: most EV load lands 18:00-23:00. */
function evProfile(hour: number): number {
  const h = hourOfClock(hour);
  if (h >= 18 && h <= 23) return 1.65;
  if (h >= 6 && h < 9) return 1.2;
  return 0.75;
}

/**
 * Dimensionless load index. Only ratios of two indices are ever consumed, so the
 * absolute scale is irrelevant — but the *shape* is what makes each knob bite.
 */
export function loadIndex(p: CityParams, hour: number, mix: { residentialShare: number; commercialShare: number; industrialShare: number }): number {
  const cool = coolingFactor(p.temperatureC, p.humidityPct);
  const residential = p.population * p.perCapitaKWh * mix.residentialShare * cool;
  const commercial = p.population * p.perCapitaKWh * mix.commercialShare * p.commercialActivity * (1 + (cool - 1) * 1.25);
  const industrial = p.population * p.perCapitaKWh * mix.industrialShare * p.industrialActivity;
  const ev = p.households * p.evPenetration * 1.15 * 0.35 * evProfile(hour) * 8760 * 0.0001;
  const efficiency = Math.max(0.4, 2 - p.efficiency);
  return (residential + commercial + industrial) * efficiency + ev;
}

export type CityLoad = {
  cityId: string;
  /** Model output for the state, MW. Real forecast, not scaled by player edits. */
  modelStateMW: number;
  cityMW: number;
  scenarioMult: number;
  solarOffsetMW: number;
  grossMW: number;
  netMW: number;
  /** Share of the city load that is weather-driven, for the panel breakdown. */
  coolingShare: number;
};

/**
 * One city at one hour. `modelStateMW` is the trained model's MW for the underlying
 * state series; everything else is derived from it plus the player's edits.
 */
export function cityLoad(city: City, hour: number, modelStateMW: number): CityLoad {
  const params = city.params;
  const current = loadIndex(params, hour, city.mix);
  const base = loadIndex(city.baseline, hour, city.mix);
  const scenarioMult = base > 0 ? current / base : 1;
  const cityMW = modelStateMW * city.metroShare;
  const grossMW = cityMW * scenarioMult;
  const solarOffsetMW = Math.min(
    params.solarCapacityMW * irradianceFactor(hour),
    grossMW * 0.45,
  );
  const cool = coolingFactor(params.temperatureC, params.humidityPct);
  return {
    cityId: city.id,
    modelStateMW,
    cityMW,
    scenarioMult,
    solarOffsetMW,
    grossMW,
    netMW: Math.max(0, grossMW - solarOffsetMW),
    coolingShare: Math.max(0, (cool - 1) / cool),
  };
}
