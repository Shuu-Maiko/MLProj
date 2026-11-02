/**
 * The clock. Moving the origin is the only map-level interaction the model needs to
 * demonstrate: the forecast is re-issued from wherever you put the playhead.
 */

import { START_HOUR } from '@/lib/scenario';
import { SpriteIcon } from './SpriteIcon';
import { formatClock, hourOfClock } from '@/lib/sim';

const SPEEDS: { v: 0 | 1 | 2 | 4 | 8; frame: Parameters<typeof SpriteIcon>[0]['frame']; label: string }[] = [
  { v: 0, frame: 'pause', label: 'pause' },
  { v: 1, frame: 'speed_1', label: 'play at ×1' },
  { v: 2, frame: 'speed_2', label: 'play at ×2' },
  { v: 4, frame: 'speed_4', label: 'play at ×4' },
  { v: 8, frame: 'speed_8', label: 'play at ×8' },
];

const SPAN_H = 720;
const END_H = START_HOUR + SPAN_H;

export function ClockBar({ hour, setHour, speed, setSpeed }: {
  hour: number;
  setHour: (h: number) => void;
  speed: 0 | 1 | 2 | 4 | 8;
  setSpeed: (s: 0 | 1 | 2 | 4 | 8) => void;
}) {
  return (
    <div className="panel pointer-events-auto flex items-center gap-4 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="eyebrow">forecast origin</span>
        <span className="stat text-value">{formatClock(hour)}</span>
        <span className="text-label text-ink-dim">
          hour {String(hourOfClock(hour)).padStart(2, '0')} · day {Math.floor((hour - START_HOUR) / 24) + 1}
        </span>
      </div>

      <input
        type="range" className="max-w-[520px] flex-1" min={START_HOUR} max={END_H - 1} step={1}
        aria-label="forecast origin"
        value={Math.min(Math.max(hour, START_HOUR), END_H - 1)}
        onChange={(e) => setHour(Number(e.target.value))}
      />

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button key={s.v} className="btn px-2" data-on={speed === s.v}
            onClick={() => setSpeed(s.v)} aria-label={s.label} title={s.label}>
            <SpriteIcon frame={s.frame} size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}
