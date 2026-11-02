/**
 * Mounts the Phaser world and keeps it in step with React state.
 *
 * Phaser and the scene module are imported inside the effect: the scene touches browser
 * globals at construction time, so it must never be evaluated during server render. The
 * scene is built once and then driven imperatively — a React re-render must not rebuild
 * a 56x56 tile map.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { CityScene, SceneBridge, SceneData, SpriteAnchors } from '@/game/scene';
import type { CityLoad } from '@/lib/sim';
import { buildWorld, type CatalogueEntry } from '@/lib/world';
import type { City, Selection } from '@/lib/types';

import catalogueJson from '../../public/assets/catalogue.json';
import anchorsJson from '../../public/assets/anchors.json';

const catalogue = catalogueJson as unknown as CatalogueEntry[];
const anchors = anchorsJson as unknown as Record<string, SpriteAnchors>;

export type GameCanvasProps = {
  cities: City[];
  hour: number;
  selection: Selection;
  loads: Map<string, CityLoad>;
  /** Bump to re-centre the camera on the current selection. */
  focusToken: number;
  bridge: SceneBridge;
};

export function GameCanvas(props: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CityScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const world = useMemo(() => buildWorld(catalogue), []);
  // The bridge's closures change every render; hand the scene a stable indirection.
  const bridgeRef = useRef(props.bridge);
  bridgeRef.current = props.bridge;

  useEffect(() => {
    let disposed = false;
    let game: import('phaser').Game | null = null;
    let raf = 0;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const Phaser = (await import('phaser')).default;
      const { CityScene: Scene } = await import('@/game/scene');
      if (disposed) return;

      const bridge: SceneBridge = {
        onSelect: (sel) => bridgeRef.current.onSelect(sel),
        onZoom: (z) => bridgeRef.current.onZoom(z),
      };
      const data: SceneData = {
        world,
        cities: props.cities,
        bridge,
        anchors: { plant: anchors.plant_day },
      };

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        backgroundColor: '#0b1120',
        pixelArt: true,
        roundPixels: true,
        render: { antialias: false },
        scale: { mode: Phaser.Scale.RESIZE, autoRound: true },
      });
      game.scene.add('city', Scene, true, data);

      // add(..., autoStart) boots asynchronously; poll until the instance exists so the
      // first forwarded frame is complete rather than half-built.
      const waitForScene = () => {
        if (disposed) return;
        const found = game?.scene.getScene('city') as CityScene | undefined;
        if (found) setScene(found);
        else raf = requestAnimationFrame(waitForScene);
      };
      waitForScene();
    })().catch((e: unknown) => {
      if (!disposed) setFailed(e instanceof Error ? e.message : String(e));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      game?.destroy(true);
    };
    // One live game per mount; everything else is forwarded by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useEffect(() => {
    if (!scene) return;
    scene.setCities(props.cities);
    scene.setLoads(props.loads);
    scene.setClock(props.hour);
    scene.setSelection(props.selection);
  }, [scene, props.cities, props.loads, props.hour, props.selection]);

  useEffect(() => {
    if (!scene || props.focusToken === 0) return;
    scene.focusOn(props.selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusToken]);

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="h-full w-full" style={{ imageRendering: 'pixelated' }} />
      {!scene && !failed && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 panel px-4 py-2 text-value text-cyan">
          LOADING WORLD
        </div>
      )}
      {failed && (
        <div className="panel absolute inset-0 flex items-center justify-center p-6 text-value text-danger">
          Phaser failed to start: {failed}
        </div>
      )}
    </div>
  );
}
