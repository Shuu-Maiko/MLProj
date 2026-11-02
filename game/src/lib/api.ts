/**
 * Typed client for the forecast service, and the shapes the game mirrors.
 *
 * Every demand number in the UI ultimately comes from here or from the calibration
 * multiplier in lib/sim.ts — nothing is baked into the frontend.
 */

export type WeatherNow = {
  temperature_2m: number;
  apparent_temperature?: number;
  relative_humidity_2m: number;
  shortwave_radiation: number;
  wind_speed_10m: number;
  precipitation: number;
};

export type CityMeta = {
  id: string;
  stateCode: string;
  stateName: string;
  metroShare: number;
  weather: WeatherNow;
  modelMAPE_pct: number | null;
};

export type ForecastPoint = {
  offsetH: number;
  timestamp: string;
  p10MW: number;
  p50MW: number;
  p90MW: number;
};

export type WeatherStep = {
  timestamp: string;
  temperatureC: number;
  humidityPct: number;
  irradianceWm2: number;
  windKmh: number;
  precipMm: number;
};

export type ForecastResult = {
  cityId: string | null;
  stateCode: string;
  stateName: string;
  metroShare: number | null;
  model: string;
  horizonH: number;
  points: ForecastPoint[];
  /** Covariates actually fed to the model per step, after the scenario override. */
  weather: WeatherStep[];
  /** Measured weather at the origin hour, for comparison with the above. */
  weatherUsed: Record<string, number>;
  basis: 'model+calibration';
  warnings: string[];
};

export type ScenarioWeather = {
  temperature_c?: number;
  humidity_pct?: number;
  irradiance_wm2?: number;
  wind_kmh?: number;
  precip_mm?: number;
};

export type ModelInfo = {
  served: {
    model: string;
    params: number;
    trained_on?: string;
    window: string[];
    states: number;
    horizon_hours: number;
    quantiles?: number[];
    game_epoch?: string;
    max_game_hours?: number;
  };
  benchmark: {
    ranking?: { model: string; MAE_MW: number; MAPE_pct: number; PI80_coverage_pct: number }[];
    baselines?: Record<string, { MAE_MW: number; MAPE_pct: number }>;
    lightgbm?: {
      overall?: {
        MAE_MW: number; MAPE_pct: number; PI80_coverage_pct: number;
        raw_quantile_PI80_coverage_pct?: number;
      };
      naive?: Record<string, { MAE_MW: number; MAPE_pct: number }>;
      mae_reduction_vs_naive_pct?: Record<string, number>;
    };
    weather_response?: Record<string, { sweep?: Record<string, number>; total_response_pct?: number }>;
  };
  dataset?: {
    targets?: Record<string, unknown>;
    sources?: Record<string, string>;
    caveats?: string[];
  };
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchCities(hour: number) {
  return get<{ hour: number; epoch: string; cities: CityMeta[] }>(`/api/cities?hour=${hour}`);
}

export function fetchForecast(cityId: string, hour: number, horizonH: number, scenario: ScenarioWeather) {
  return post<ForecastResult>('/api/forecast', { city_id: cityId, hour, horizon_h: horizonH, scenario });
}

export function fetchModelInfo() {
  return get<ModelInfo>('/api/model');
}

export function fetchHistory(state: string, hour: number, hours = 48) {
  return get<{ state: string; points: { timestamp: string; measuredMW: number | null }[]; note: string }>(
    `/api/history?state=${state}&hour=${hour}&hours=${hours}`,
  );
}
