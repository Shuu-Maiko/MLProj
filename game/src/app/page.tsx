/**
 * App shell.
 *
 * `useGame` is the only source of numbers; the canvas and every panel read it, so the map
 * label and the header can never disagree.
 *
 * Three bands, one column of controls: grid totals up top, the prediction and its levers
 * on the right, the forecast origin along the bottom. Everything else is map.
 */

'use client';

import { useCallback, useMemo, useState } from 'react';

import { ClockBar } from '@/components/ClockBar';
import { GameCanvas } from '@/components/GameCanvas';
import { ModelCard } from '@/components/ModelCard';
import { CityPanel, CityTabs, InfoPanel } from '@/components/SidePanel';
import { TopBar } from '@/components/TopBar';
import { useGame } from '@/hooks/useGame';
import type { Selection } from '@/lib/types';

export default function App() {
  const game = useGame();
  const [focusToken, setFocusToken] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);

  const select = useCallback((sel: Selection) => {
    game.setSelection(sel);
    if (sel?.kind === 'city') {
      setModelOpen(false);
      setFocusToken((t) => t + 1);
    }
  }, [game]);

  const bridge = useMemo(() => ({ onSelect: select, onZoom: () => {} }), [select]);

  const sel = game.selection;
  const selectedCity = sel?.kind === 'city' ? game.cities.find((c) => c.id === sel.id) : undefined;

  return (
    <main className="relative h-full w-full overflow-hidden bg-page">
      <GameCanvas
        cities={game.cities}
        hour={game.hour}
        selection={game.selection}
        loads={game.loads}
        focusToken={focusToken}
        bridge={bridge}
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3">
        <TopBar
          hour={game.hour}
          netMW={game.totals.netMW}
          solarMW={game.totals.solarMW}
          model={game.modelInfo?.served.model.toUpperCase() ?? 'connecting…'}
          modelOpen={modelOpen}
          onModel={() => setModelOpen((v) => !v)}
          waiting={game.status === 'booting'}
        />

        {game.error && (
          <div className="panel pointer-events-auto border-danger px-3 py-2 text-label text-danger">
            model service: {game.error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 justify-end">
          <aside className="panel pointer-events-auto flex w-[420px] flex-col gap-3 overflow-y-auto p-3">
            <CityTabs cities={game.cities} selection={game.selection} onSelect={select} />
            {modelOpen ? (
              <ModelCard info={game.modelInfo} />
            ) : selectedCity ? (
              <CityPanel
                city={selectedCity}
                load={game.loads.get(selectedCity.id)}
                result={game.forecastResults[selectedCity.id]}
                hour={game.hour}
                modelLabel={game.modelInfo?.served.model ?? 'model'}
                weatherEdited={!!game.weatherEdited[selectedCity.id]}
                onEdit={(patch) => game.editCity(selectedCity.id, patch)}
                onReset={() => game.resetCity(selectedCity.id)}
              />
            ) : (
              <InfoPanel cities={game.cities} onSelect={select} />
            )}
          </aside>
        </div>

        <ClockBar hour={game.hour} setHour={game.setHour} speed={game.speed} setSpeed={game.setSpeed} />
      </div>
    </main>
  );
}
