/**
 * Starting scenario: three cities, one plant, and the event catalogue the player can
 * trigger.
 *
 * `baseline` is a frozen copy of the starting parameters. The simulation only ever uses
 * the ratio between the two, so these absolute figures are for display and editing —
 * the MW level comes from the trained model, never from here.
 */

import type { City, CityParams, SectorMix } from './types';

const START: Record<string, CityParams> = {
  delta: {
    population: 32_000_000, households: 8_000_000, perCapitaKWh: 1_100,
    industrialActivity: 0.9, commercialActivity: 1.05, evPenetration: 0.04,
    solarCapacityMW: 420, efficiency: 1.0, temperatureC: 24, humidityPct: 55,
  },
  nova: {
    population: 14_000_000, households: 3_600_000, perCapitaKWh: 1_250,
    industrialActivity: 0.75, commercialActivity: 1.2, evPenetration: 0.09,
    solarCapacityMW: 780, efficiency: 1.05, temperatureC: 26, humidityPct: 62,
  },
  harbor: {
    population: 21_000_000, households: 5_500_000, perCapitaKWh: 1_400,
    industrialActivity: 1.25, commercialActivity: 1.1, evPenetration: 0.06,
    solarCapacityMW: 260, efficiency: 0.95, temperatureC: 29, humidityPct: 71,
  },
};

const MIX: Record<string, SectorMix> = {
  delta: { residentialShare: 0.34, commercialShare: 0.28, industrialShare: 0.38 },
  nova: { residentialShare: 0.42, commercialShare: 0.42, industrialShare: 0.16 },
  harbor: { residentialShare: 0.31, commercialShare: 0.24, industrialShare: 0.45 },
};

const META: Record<string, { city: string; stateCode: string; stateName: string; metroShare: number; firmMW: number }> = {
  delta: { city: 'Delhi', stateCode: 'DL', stateName: 'Delhi', metroShare: 0.85, firmMW: 4_300 },
  nova: { city: 'Bengaluru', stateCode: 'KRT', stateName: 'Karnataka', metroShare: 0.25, firmMW: 3_100 },
  harbor: { city: 'Mumbai', stateCode: 'MHA', stateName: 'Maharashtra', metroShare: 0.23, firmMW: 6_200 },
};

/**
 * The scenario opens on 2026-04-12 00:00 IST, not on the dataset's first hour.
 *
 * Weather is the game's main lever, and the served model only answers it in the right
 * direction inside the distribution it saw: asked for 45 °C at a January origin it
 * predicts *less* demand than at 8 °C, because hot afternoons in the data are all
 * pre-monsoon. April is where a heatwave raises the load, so that is where the player
 * starts. Measured Delhi temperature at this origin is 26.2 °C.
 */
export const START_HOUR = 2_424;

export function initialCities(): City[] {
  return Object.entries(META).map(([id, m]) => ({
    id,
    name: m.city,
    stateCode: m.stateCode,
    stateName: m.stateName,
    metroShare: m.metroShare,
    grid: { x: 0, y: 0 },
    params: { ...START[id] },
    baseline: { ...START[id] },
    mix: { ...MIX[id] },
    capacityFirmMW: m.firmMW,
  }));
}
