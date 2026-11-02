/**
 * Forecast strip for the selected city.
 *
 * Two series on purpose: the measured state load behind the model, and the model's
 * p10/p50/p90 band. Both are multiplied by the city's calibration share and the live
 * scenario multiplier, so the curve a player edits is the curve the map label reads.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import { SpriteIcon } from './SpriteIcon';
import { fetchHistory } from '@/lib/api';
import type { ForecastResult } from '@/lib/api';
import { hourOfClock } from '@/lib/sim';
import type { City } from '@/lib/types';

type Row = {
  t: number;
  label: string;
  band: number;
  bandTop: number;
  p50: number | null;
  measured: number | null;
};

const nf = (v: number) => Math.round(v).toLocaleString('en-IN');

export function ForecastChart({ city, result, mult, share, hour, modelLabel }: {
  city: City;
  result?: ForecastResult;
  mult: number;
  share: number;
  hour: number;
  modelLabel: string;
}) {
  const [history, setHistory] = useState<{ t: number; mw: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    // The measured series is hourly and state-wide; refetch only when the day changes.
    fetchHistory(city.stateCode, hour, 48)
      .then((h) => {
        if (cancelled) return;
        setHistory(h.points
          .map((p, i) => ({ t: hour - 47 + i, mw: p.measuredMW }))
          .filter((p): p is { t: number; mw: number } => p.mw !== null));
      })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [city.stateCode, Math.floor(hour / 12)]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const h of history) {
      out.push({
        t: h.t,
        label: `${hourOfClock(h.t)}:00`,
        band: 0, bandTop: 0, p50: null,
        measured: h.mw * share,
      });
    }
    for (const p of result?.points ?? []) {
      const t = hour + p.offsetH;
      out.push({
        t,
        label: `${hourOfClock(t)}:00`,
        band: p.p10MW * share * mult,
        bandTop: (p.p90MW - p.p10MW) * share * mult,
        p50: p.p50MW * share * mult,
        measured: null,
      });
    }
    return out.sort((a, b) => a.t - b.t);
  }, [history, result, share, mult, hour]);

  if (!result || !result.points.length) {
    return (
      <div className="flex h-[190px] items-center justify-center text-label text-ink-dim">
        no forecast yet — is the model service running?
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-dim">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-5" style={{ background: 'rgba(95,220,230,.30)' }} />
          p10–p90 interval
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5 bg-amber" />
          forecast median
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5 bg-cyan" />
          measured state × {(share * 100).toFixed(0)} %
        </span>
      </div>
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#33415e" strokeDasharray="2 2" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#a3b3cf' }} interval={5} stroke="#33415e" />
            <YAxis tick={{ fontSize: 12, fill: '#a3b3cf' }} width={52} stroke="#33415e"
              tickFormatter={(v: number) => nf(v)} />
            <Tooltip
              contentStyle={{
                background: '#182136', border: '2px solid #33415e', borderRadius: 0,
                fontSize: 14, fontFamily: 'inherit', color: '#e8eefb',
              }}
              formatter={(v: unknown, name: unknown) =>
                [`${nf(Number(v))} MW`, name === 'measured' ? 'measured' : name === 'p50' ? 'forecast p50' : String(name)]}
            />
            <Area dataKey="band" stackId="pi" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="bandTop" stackId="pi" stroke="none" fill="#5fdce6" fillOpacity={0.28}
              isAnimationActive={false} name="p10–p90" />
            <Line dataKey="measured" stroke="#5fdce6" strokeWidth={2.5} dot={false}
              isAnimationActive={false} name="measured" connectNulls={false} />
            <Line dataKey="p50" stroke="#ffc061" strokeWidth={2.5} dot={false}
              isAnimationActive={false} name="p50" connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {result.warnings.length > 0 && (
        <ul className="mt-1 text-label leading-snug text-amber">
          {result.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1">
              <SpriteIcon frame="alert_warning" size={14} className="mt-[3px]" />{w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
