/**
 * Game state and loop.
 *
 * Owns the clock, the editable scenario and the forecast cache, and derives each city's
 * load from the model's output. The renderer and the HUD are both consumers of this, so
 * the number in the top bar and the number on the map can never disagree.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchCities, fetchForecast, fetchModelInfo } from '@/lib/api';
import type { ForecastResult, ModelInfo } from '@/lib/api';
import { cityLoad, formatClock, hourOfClock, type CityLoad } from '@/lib/sim';
import { START_HOUR, initialCities } from '@/lib/scenario';
import type { City, CityParams, Selection } from '@/lib/types';

/** Re-fetch when the clock moves more than this many hours past the cached origin. */
const REFRESH_HOURS = 6;
const HORIZON = 24;

export type GameStatus = 'booting' | 'playing' | 'degraded';

export function useGame() {
  const [cities, setCities] = useState<City[]>(() => initialCities());
  const [hour, setHour] = useState(START_HOUR);
  const [speed, setSpeed] = useState<0 | 1 | 2 | 4 | 8>(1);
  // Start on a city: the prediction is the point of the screen, so it should be up
  // before the user does anything.
  const [selection, setSelection] = useState<Selection>(() => ({ kind: 'city', id: 'delta' }));
  const [forecasts, setForecasts] = useState<
    Record<string, { result: ForecastResult; atHour: number; sig: string }>
  >({});
  const [weatherEdited, setWeatherEdited] = useState<Record<string, boolean>>({});
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(0);
  const inFlight = useRef<Set<string>>(new Set());

  // --- boot: real weather + model card from the service ---------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCities(START_HOUR), fetchModelInfo()])
      .then(([c, m]) => {
        if (cancelled) return;
        setModelInfo(m);
        setCities((prev) => prev.map((city) => {
          const meta = c.cities.find((x) => x.id === city.name);
          if (!meta) return city;
          const params = {
            ...city.params,
            temperatureC: Math.round(meta.weather.temperature_2m * 10) / 10,
            humidityPct: Math.round(meta.weather.relative_humidity_2m),
          };
          return { ...city, params, baseline: { ...city.baseline, ...params } };
        }));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  // --- clock ---------------------------------------------------------------
  useEffect(() => {
    if (speed === 0) return;
    const id = setInterval(() => setHour((h) => h + 1), 1400 / speed);
    return () => clearInterval(id);
  }, [speed]);

  // --- forecast fetching ---------------------------------------------------
  const requestForecast = useCallback(async (city: City, atHour: number) => {
    const key = city.id;
    const sig = JSON.stringify(city.params);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const result = await fetchForecast(city.name, Math.max(0, atHour - 1), HORIZON, {
        temperature_c: city.params.temperatureC,
        humidity_pct: city.params.humidityPct,
      });
      setForecasts((prev) => ({ ...prev, [key]: { result, atHour, sig } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current.delete(key);
      // An edit that landed mid-flight left the cache holding the wrong scenario;
      // re-run the staleness check so it gets requested again.
      setSettled((n) => n + 1);
    }
  }, []);

  // Fetch when the cache is missing, stale, or the scenario changed.
  const signature = useMemo(
    () => cities.map((c) => `${c.id}:${JSON.stringify(c.params)}`).join('|'),
    [cities],
  );
  useEffect(() => {
    for (const city of cities) {
      const cached = forecasts[city.id];
      const stale = !cached
        || Math.abs(hour - cached.atHour) >= REFRESH_HOURS
        || cached.sig !== JSON.stringify(city.params);
      if (stale) void requestForecast(city, hour);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hour, signature, settled]);

  // --- derived state -------------------------------------------------------
  const loads = useMemo(() => {
    const map = new Map<string, CityLoad>();
    for (const city of cities) {
      const point = forecasts[city.id]?.result.points[0];
      if (!point) continue;
      map.set(city.id, cityLoad(city, hour, point.p50MW));
    }
    return map;
  }, [cities, forecasts, hour]);

  const totals = useMemo(() => {
    let net = 0, solar = 0;
    for (const l of loads.values()) { net += l.netMW; solar += l.solarOffsetMW; }
    return { netMW: net, solarMW: solar };
  }, [loads]);

  // --- mutations -----------------------------------------------------------
  const editCity = useCallback((id: string, patch: Partial<CityParams>) => {
    setCities((prev) => prev.map((c) => (c.id === id ? { ...c, params: { ...c.params, ...patch } } : c)));
    if ('temperatureC' in patch || 'humidityPct' in patch) {
      setWeatherEdited((prev) => ({ ...prev, [id]: true }));
    }
  }, []);

  const resetCity = useCallback((id: string) => {
    setCities((prev) => prev.map((c) => (c.id === id ? { ...c, params: { ...c.baseline } } : c)));
    setWeatherEdited((prev) => ({ ...prev, [id]: false }));
  }, []);

  const status: GameStatus = error ? 'degraded' : Object.keys(forecasts).length ? 'playing' : 'booting';

  return {
    cities, hour, speed, selection, loads, totals, modelInfo, status, error,
    forecastResults: Object.fromEntries(Object.entries(forecasts).map(([k, v]) => [k, v.result])),
    weatherEdited,
    setHour, setSpeed, setSelection, editCity, resetCity,
  };
}

export { formatClock, hourOfClock };
