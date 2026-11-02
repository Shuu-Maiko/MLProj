/** Shared vocabulary between the simulation, the renderer and the React HUD. */

export type SectorMix = {
  residentialShare: number;
  commercialShare: number;
  industrialShare: number;
};

/** Everything the player can edit for a city. Mirrors the panel fields 1:1. */
export type CityParams = {
  population: number;
  households: number;
  perCapitaKWh: number;
  industrialActivity: number;
  commercialActivity: number;
  evPenetration: number;
  solarCapacityMW: number;
  efficiency: number;
  temperatureC: number;
  humidityPct: number;
};

export type City = {
  id: string;
  name: string;
  /** Real measurement series the model was trained on. */
  stateCode: string;
  stateName: string;
  /** Calibration constant: metro share of state demand. Labelled synthetic. */
  metroShare: number;
  grid: { x: number; y: number };
  params: CityParams;
  baseline: CityParams;
  mix: SectorMix;
  /** Peak load the district was built for; the map's flow animation reads against it. */
  capacityFirmMW: number;
};

export type ForecastPoint = {
  /** Hours from the simulation clock. */
  offsetH: number;
  timestamp: string;
  p10MW: number;
  p50MW: number;
  p90MW: number;
};

export type Selection =
  | { kind: 'city'; id: string }
  | { kind: 'tile'; x: number; y: number }
  | null;

