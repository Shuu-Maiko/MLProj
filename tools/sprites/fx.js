/**
 * Animated effects: electricity travelling along a line, chimney plumes, steam, sparks
 * and the tint tiles used by map overlays.
 *
 * Everything here is drawn on a transparent tile the same width as the ground diamond,
 * so an effect can simply be pinned to a map cell and stay in register with it.
 */

import { Painter, TILE_W, TILE_H, HW, HH } from './painter.js';
import { PALETTE } from './palette.js';

/**
 * A charge pulse moving along a wire. `frame` advances the glow, `level` is the
 * simulated load 0..1 which drives brightness and how much of the halo is lit.
 */
export function pulse(frame, level = 0.6) {
  const p = new Painter(16, 12);
  const core = level > 0.9 ? PALETTE.ui.red : level > 0.7 ? PALETTE.energy.bright : PALETTE.energy.spark;
  const halo = level > 0.7 ? PALETTE.energy.bright : PALETTE.energy.mid;
  const r = 3 + level * 2 + (frame % 2);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y * 2.2);
      if (d > r + 1.5) continue;
      if (d < r * 0.45) p.set(8 + x, 6 + y, core);
      else if (d < r) p.set(8 + x, 6 + y, halo);
    }
  }
  p.set(8, 6, '#ffffff');
  return p;
}

/** Rising smoke/steam puff. `frame` 0..3 grows and fades the cloud. */
export function plume(frame, color = PALETTE.road.light, hot = false) {
  const p = new Painter(24, 34);
  const grow = 3 + frame * 2.2;
  const rise = frame * 6;
  const blobs = [[0, 0, 1], [-3.5, 2, 0.75], [3.5, 2.5, 0.7], [-1, -3, 0.6]];
  const tint = hot && frame > 1 ? PALETTE.metal.light : color;
  for (const [bx, by, s] of blobs) {
    const r = Math.max(1, Math.round(grow * s));
    const cx = 12 + bx, cy = 28 - rise + by;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const edge = Math.sqrt(x * x + y * y) / r;
        const a = Math.round(200 * (1 - frame / 4.5) * (1 - edge * 0.55));
        if (a > 24) p.set(cx + x, cy + y, tint, a);
      }
    }
  }
  return p;
}

/** Small spark flash used on transformers and line terminations. */
export function spark(frame) {
  const p = new Painter(14, 14);
  const c = frame % 2 ? PALETTE.energy.spark : PALETTE.energy.bright;
  const arm = 2 + (frame % 3);
  p.line(7 - arm, 7, 7 + arm, 7, c);
  p.line(7, 7 - arm, 7, 7 + arm, c);
  if (frame % 2) {
    p.line(5, 5, 9, 9, PALETTE.energy.glow);
    p.line(9, 5, 5, 9, PALETTE.energy.glow);
  }
  return p;
}

/**
 * A full-tile diamond in a single flat colour, drawn nearly transparent so the game can
 * tint it per overlay. Keeping it opaque-white and tinting at runtime is what lets one
 * sprite serve demand, population, stress and weather overlays.
 */
export function tintTile() {
  const p = new Painter(TILE_W, TILE_H);
  p.diamond(HW, HH, '#ffffff');
  return p;
}

/** Selection ring drawn around the currently picked tile or building. */
export function selectionRing(color = PALETTE.ui.cyan) {
  const p = new Painter(TILE_W, TILE_H);
  for (let i = 0; i <= HW; i++) {
    p.set(HW - i, HH - (i * HH) / HW, color);
    p.set(HW + i, HH - (i * HH) / HW, color);
    p.set(HW - i, HH + (i * HH) / HW, color);
    p.set(HW + i, HH + (i * HH) / HW, color);
  }
  return p;
}

/** Hover ring, thinner and dimmer than the selection ring. */
export function hoverRing(color = PALETTE.ui.text) {
  const p = new Painter(TILE_W, TILE_H);
  p.diamondEdges(HW, HH, { nw: color, ne: color, se: color, sw: color });
  return p;
}

/**
 * A drooping cable between two attachment points, generated at the length the map
 * needs. Returns a painter plus the sampled path so pulses can follow the sag.
 */
export function cable(from, to, sag = 6) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const p = new Painter(len + 4, len + sag + 8);
  const pts = [];
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    const x = from[0] + dx * t + 2;
    const y = from[1] + dy * t + Math.sin(Math.PI * t) * sag + sag + 2;
    pts.push([Math.round(x), Math.round(y)]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], PALETTE.cable.mid);
  }
  return { painter: p, path: pts.map(([x, y]) => [x - 2, y - sag - 2]) };
}
