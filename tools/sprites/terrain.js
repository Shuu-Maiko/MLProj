/**
 * Terrain: ground, water, roads and natural features on the 64x32 diamond grid.
 *
 * Road tiles are drawn as a diamond that meets its neighbours exactly at the shared
 * edge, so roads read as continuous tarmac instead of separate patches.
 */

import { Painter, TILE_W, TILE_H, HW, HH, isoPoint } from './painter.js';
import { PALETTE, darken, lighten } from './palette.js';

const G = PALETTE.grass;

/** Paint the base diamond with a deterministic speckle so flat ground has texture. */
function ground(p, cx, cy, seed = 1, base = G.mid, light = G.light, dark = G.dark) {
  p.diamond(cx, cy, base);
  let s = seed * 9301;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 34; i++) {
    const gx = (rnd() * 1.6 - 0.8);
    const gy = (rnd() * 1.6 - 0.8);
    // Shrink toward the centre so speckles never spill past the diamond edge.
    const px = cx + Math.round(gx * HW * 0.82);
    const py = cy + Math.round(gy * HH * 0.62);
    if (onDiamond(px - cx, py - cy)) p.set(px, py, rnd() > 0.45 ? light : dark);
  }
  // A darker rim along the two south edges gives the tile stack visible depth.
  p.diamondEdges(cx, cy, { se: dark, sw: dark });
}

function onDiamond(dx, dy) {
  return Math.abs(dx) / HW + Math.abs(dy) / HH <= 1;
}

export function grass(seed) {
  const p = new Painter(TILE_W, TILE_H);
  ground(p, HW, HH, seed);
  return p;
}

export function dirt(seed) {
  const p = new Painter(TILE_W, TILE_H);
  ground(p, HW, HH, seed, PALETTE.dirt.mid, PALETTE.dirt.light, PALETTE.dirt.dark);
  return p;
}

export function sand(seed) {
  const p = new Painter(TILE_W, TILE_H);
  ground(p, HW, HH, seed, PALETTE.sand.mid, PALETTE.sand.light, PALETTE.sand.dark);
  return p;
}

/** Four-frame water animation: crest highlights drift east, troughs stay deep. */
export function water(frame) {
  const p = new Painter(TILE_W, TILE_H);
  const W = PALETTE.water;
  p.diamond(HW, HH, W.mid);
  p.diamond(HW, HH + 1, W.dark, TILE_W, TILE_H - 4);
  let s = frame * 7717 + 3;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 5; i++) {
    const y = Math.round(-HH + 4 + rnd() * (TILE_H - 8));
    const x0 = Math.round(-HW + 6 + rnd() * (HW - 10));
    const len = 4 + Math.round(rnd() * 10);
    const drift = frame * 2 - 3;
    for (let k = 0; k < len; k++) {
      const px = HW + x0 + k + drift;
      const py = HH + y;
      if (onDiamond(px - HW, py - HH)) p.set(px, py, i % 2 ? W.high : W.deep);
    }
  }
  return p;
}

const ROAD = PALETTE.road;

/**
 * Asphalt diamond with per-edge kerb tones. Light comes from the north-west, so the
 * two north-west facing edges are brighter than the two south-east facing ones.
 */
function asphalt(p) {
  p.diamond(HW, HH, ROAD.mid);
  p.diamondEdges(HW, HH, {
    nw: ROAD.light, ne: ROAD.light, se: ROAD.dark, sw: ROAD.dark,
  });
}

/**
 * Straight road. axis 'x' runs toward the south-east neighbour, 'y' toward the
 * south-west neighbour; the centre dashes enter and exit through opposite edge
 * midpoints so adjacent tiles line up into one continuous carriageway.
 */
export function roadStraight(axis) {
  const p = new Painter(TILE_W, TILE_H);
  asphalt(p);
  if (axis === 'x') p.line(HW / 2, HH / 2, HW + HW / 2, HH + HH / 2, ROAD.mark);
  else p.line(HW + HW / 2, HH / 2, HW / 2, HH + HH / 2, ROAD.mark);
  return p;
}

export function roadIntersection() {
  const p = new Painter(TILE_W, TILE_H);
  asphalt(p);
  p.diamond(HW, HH, ROAD.mark, 10, 5);
  return p;
}

/**
 * Curve tile joining the two road edges that meet at `corner`
 * (0 = north, 1 = east, 2 = south, 3 = west). The centre line is a quadratic through
 * the corner so it leaves each edge at its midpoint, matching the straight tiles.
 */
export function roadCurve(corner = 0) {
  const p = new Painter(TILE_W, TILE_H);
  asphalt(p);
  const mid = {
    nw: [HW / 2, HH / 2], ne: [HW + HW / 2, HH / 2],
    se: [HW + HW / 2, HH + HH / 2], sw: [HW / 2, HH + HH / 2],
  };
  const tip = [[HW, 0], [TILE_W, HH], [HW, TILE_H], [0, HH]][corner];
  const pairs = [[mid.nw, mid.ne], [mid.ne, mid.se], [mid.se, mid.sw], [mid.sw, mid.nw]];
  const [a, b] = pairs[corner];
  let prev = null;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * tip[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * tip[1] + t * t * b[1];
    if (prev) p.line(prev[0], prev[1], x, y, ROAD.mark);
    prev = [x, y];
  }
  return p;
}

/** Pine/deciduous tree cluster sitting on a grass tile. */
export function forest(seed) {
  const p = new Painter(TILE_W, TILE_H + 28);
  const cy = HH + 24;
  ground(p, HW, cy, seed);
  const F = PALETTE.forest;
  const trees = [[HW - 14, cy - 2, 12], [HW + 10, cy - 6, 15], [HW - 2, cy + 6, 10]];
  for (const [tx, ty, size] of trees) {
    p.set(tx, ty, F.trunk); p.set(tx, ty - 1, F.trunk);
    for (let layer = 0; layer < 3; layer++) {
      const w = Math.round(size - layer * 3);
      const top = ty - 4 - layer * 5;
      p.poly([[tx, top - 5], [tx + w, top + 4], [tx - w, top + 4]],
        layer === 0 ? F.dark : layer === 1 ? F.mid : F.light);
    }
  }
  return p;
}

/** Rocky hill with an optional snow cap; taller sprites overlap the tile behind. */
export function mountain(seed, snowy = false) {
  const p = new Painter(TILE_W, TILE_H + 34);
  const cy = HH + 30;
  ground(p, HW, cy, seed, PALETTE.dirt.mid, PALETTE.dirt.light, PALETTE.dirt.dark);
  const R = PALETTE.rock;
  const peakY = cy - 30;
  p.poly([[HW, peakY], [HW + 26, cy - 8], [HW + 6, cy + 4], [HW - 22, cy - 10]], R.mid);
  p.poly([[HW, peakY], [HW - 22, cy - 10], [HW - 30, cy - 4], [HW - 6, cy + 4]], R.light);
  p.poly([[HW, peakY + 4], [HW + 26, cy - 8], [HW + 10, cy - 2]], R.dark);
  if (snowy) {
    p.poly([[HW, peakY], [HW + 9, peakY + 9], [HW + 2, peakY + 11], [HW - 7, peakY + 8]], R.snow);
  }
  for (let i = 0; i < 6; i++) {
    p.set(HW - 16 + i * 5, cy - 14 + (i % 3) * 4, darken(R.mid, 0.18));
  }
  return p;
}

/** Faint diamond outline marking a parcel the player can build on. */
export function plotMarker(color = lighten(PALETTE.ui.cyan, 0.1)) {
  const p = new Painter(TILE_W, TILE_H);
  for (let i = 0; i < HW; i++) {
    const t = i / HW;
    p.set(HW - i, Math.round(t * HH), color);
    p.set(HW + i, Math.round(t * HH), color);
    p.set(HW - i, TILE_H - Math.round(t * HH), color);
    p.set(HW + i, TILE_H - Math.round(t * HH), color);
  }
  return p;
}
