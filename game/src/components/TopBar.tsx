/**
 * Top strip: the clock, the summed prediction across the three series, and the entry
 * point to the model card.
 */

import { SpriteIcon } from './SpriteIcon';
import { formatClock, hourOfClock } from '@/lib/sim';

const nf = (v: number) => Math.round(v).toLocaleString('en-IN');

function Cell({ label, value, tone = 'text-ink' }: {
  label: string; value: string; tone?: string;
}) {
  return (
    <div className="flex flex-col justify-center border-l-2 border-line px-4 first:border-l-0">
      <span className="text-eyebrow uppercase tracking-[0.08em] text-ink-dim">{label}</span>
      <span className={`stat text-value leading-tight ${tone}`}>{value}</span>
    </div>
  );
}

export function TopBar({ hour, netMW, solarMW, model, modelOpen, onModel, waiting }: {
  hour: number;
  netMW: number;
  solarMW: number;
  model: string;
  modelOpen: boolean;
  onModel: () => void;
  waiting: boolean;
}) {
  const h = hourOfClock(hour);
  const period = h < 6 || h >= 20 ? 'night' : h < 10 ? 'morning ramp' : h < 18 ? 'day' : 'evening peak';

  return (
    <header className="panel pointer-events-auto flex items-stretch">
      <div className="flex flex-col justify-center px-4">
        <span className="text-eyebrow uppercase tracking-[0.08em] text-ink-dim">
          origin · {period}
        </span>
        <span className="stat text-value leading-tight">{formatClock(hour)}</span>
      </div>
      <Cell label="predicted across 3 series"
        value={waiting ? '—' : `${nf(netMW)} MW`} />
      <Cell label="after rooftop solar" value={waiting ? '—' : `${nf(solarMW)} MW offset`} tone="text-ok" />

      <div className="ml-auto flex items-center gap-3 border-l-2 border-line px-4">
        <div className="flex flex-col">
          <span className="text-eyebrow uppercase tracking-[0.08em] text-ink-dim">served model</span>
          <span className="stat text-value leading-tight text-cyan">{model}</span>
        </div>
        <button className="btn" data-on={modelOpen} onClick={onModel}>
          <SpriteIcon frame="horizon" size={18} />
          Evaluation
        </button>
      </div>
    </header>
  );
}
