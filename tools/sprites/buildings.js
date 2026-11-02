/**
 * Buildings: one parametric renderer plus a spec table, so every structure in the game
 * shares the same footprint maths, the same north-west light and the same outline.
 *
 * A spec is data rather than code, which is what lets a city carry dozens of visually
 * distinct buildings without dozens of hand-drawn functions.
 */

import { Painter, isoBox, boxFaces, faceQuad, HW, HH } from './painter.js';
import { PALETTE, OUTLINE, darken, lighten, nightify } from './palette.js';

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Canvas sized and offset so a footprint of w x d tiles with `height` px fits exactly. */
export function frame(wTiles, dTiles, height, extraTop = 20, pad = 6) {
  const w = (wTiles + dTiles) * HW + pad * 2;
  const h = (wTiles + dTiles) * HH + height + extraTop + pad;
  const p = new Painter(w, h);
  const ox = pad + dTiles * HW, oy = extraTop + height;
  p.translate(ox, oy);
  // The pixel that must land on the tile position: the footprint's north corner.
  p.origin = { x: ox, y: oy };
  return p;
}

function facade(pal, night) {
  const pick = (c) => (night ? nightify(c, 0.5) : c);
  return {
    light: pick(pal.light ?? pal.mid),
    mid: pick(pal.mid),
    dark: pick(pal.dark ?? pal.mid),
    roof: pick(pal.roof ?? darken(pal.mid, 0.25)),
  };
}

function windows(p, face, rows, cols, height, o) {
  const uSpan = face.len / cols;
  const floorH = (height - 8) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c * uSpan + uSpan * 0.26;
      const v = 6 + r * floorH;
      const glass = o.style === 'glass';
      const wh = glass ? floorH - 2 : Math.min(5, Math.max(2, floorH - 3));
      const wu = glass ? uSpan * 0.76 : uSpan * 0.48;
      const lit = o.night && o.rand() < o.litRatio;
      p.poly(faceQuad(face, u, v, wu, wh), lit
        ? (o.rand() > 0.72 ? PALETTE.window.litBright : PALETTE.window.lit)
        : (glass ? PALETTE.glass.day : PALETTE.window.day));
      if (!lit && !glass) {
        p.poly(faceQuad(face, u, v, wu, 1), o.night ? PALETTE.window.off : PALETTE.window.dark);
      }
    }
  }
}

function door(p, face, night) {
  const wu = Math.max(0.5, face.len * 0.16);
  const u = face.len / 2 - wu / 2;
  p.poly(faceQuad(face, u, 0, wu, 9), PALETTE.wood.dark);
  p.poly(faceQuad(face, u + 0.15, 1, wu - 0.3, 7), PALETTE.wood.mid);
  if (night) p.poly(faceQuad(face, u, 0, wu, 1), PALETTE.energy.glow);
}

function signBand(p, face, height, color) {
  p.poly(faceQuad(face, 0.15, height - 14, face.len * 0.7, 4), color);
  p.poly(faceQuad(face, 0.15, height - 14, face.len * 0.7, 1), lighten(color, 0.25));
}

function awning(p, face, color) {
  const u0 = face.len * 0.16, span = face.len * 0.68;
  p.poly(faceQuad(face, u0, 11, span, 3), color);
  p.poly(faceQuad(face, u0 + 0.2, 9, span - 0.4, 2), darken(color, 0.3));
}

function balconies(p, face, rows, height) {
  const floorH = (height - 8) / rows;
  for (let r = 1; r < rows; r++) {
    const v = 6 + r * floorH - 2;
    p.poly(faceQuad(face, 0.18, v, face.len - 0.36, 1.6), PALETTE.houseWall.light);
    p.poly(faceQuad(face, 0.18, v - 1.2, face.len - 0.36, 1.2), darken(PALETTE.houseWall.mid, 0.4));
  }
}

/** Rooftop clutter: the difference between a flat box and a believable building. */
function roofKit(p, w, d, rand, night) {
  const kit = facade(PALETTE.metal, night);
  const n = Math.min(4, Math.max(1, Math.round(w * d * 1.4)));
  for (let i = 0; i < n; i++) {
    const gx = 0.2 + rand() * Math.max(0.15, w - 0.75);
    const gy = 0.2 + rand() * Math.max(0.15, d - 0.75);
    const hh = 3 + Math.round(rand() * 3);
    isoBox(p, gx, gy, 0.45, 0.45, hh, {
      roof: i % 3 === 2 ? lighten(kit.light, 0.15) : kit.light, sw: kit.mid, se: kit.dark,
    });
  }
}

function solarArray(p, w, d, height, night) {
  const blue = night ? nightify(PALETTE.panel.mid, 0.5) : PALETTE.panel.mid;
  const sheen = night ? PALETTE.panel.dark : PALETTE.panel.light;
  for (let i = 0; i < Math.max(2, Math.round(w * d * 1.5)); i++) {
    const gx = 0.15 + (i % Math.max(1, w)) * 0.85;
    const gy = 0.15 + Math.floor(i / Math.max(1, w)) * 0.85;
    const a = isoShift(gx, gy, height);
    const b = isoShift(gx + 0.6, gy, height);
    const c = isoShift(gx + 0.6, gy + 0.6, height + 2);
    const e = isoShift(gx, gy + 0.6, height + 2);
    p.poly([a, b, c, e], blue);
    p.line(a[0], a[1], e[0], e[1], sheen);
  }
}

function isoShift(gx, gy, z) {
  return [(gx - gy) * HW, (gx + gy) * HH - z];
}

/** Gable roof: ridge runs north-west to south-east, planes face NE and SW. */
function gable(p, box, rise, roofPal, night) {
  const { A, B, C, D } = box;
  const mid = (x, y) => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2 - rise];
  const P1 = mid(A, D), P2 = mid(B, C);
  const light = night ? nightify(roofPal, 0.45) : lighten(roofPal, 0.14);
  const dark = night ? nightify(roofPal, 0.6) : darken(roofPal, 0.24);
  p.poly([A, B, P2, P1], light);
  p.poly([D, C, P2, P1], dark);
  p.poly([A, D, P1], night ? dark : lighten(dark, 0.1));
  p.poly([B, C, P2], dark);
  p.line(P1[0], P1[1], P2[0], P2[1], lighten(light, 0.2));
}

function hip(p, box, rise, roofPal, night) {
  const { A, B, C, D } = box;
  const apex = [(A[0] + B[0] + C[0] + D[0]) / 4, (A[1] + B[1] + C[1] + D[1]) / 4 - rise];
  const light = night ? nightify(roofPal, 0.45) : lighten(roofPal, 0.14);
  const mid = night ? nightify(roofPal, 0.55) : roofPal;
  const dark = night ? nightify(roofPal, 0.65) : darken(roofPal, 0.24);
  p.poly([A, B, apex], light);
  p.poly([B, C, apex], mid);
  p.poly([C, D, apex], dark);
  p.poly([D, A, apex], mid);
}

/**
 * Render one building.
 * Returns the painter plus anchor points (in sprite pixels, relative to the painter's
 * translate) that the game uses for smoke, signage and doorway effects.
 */
export function building(spec) {
  const {
    w = 1, d = 1, height = 24, floors = 2, wall, roofColor, roofStyle = 'flat',
    windowStyle = 'grid', details = [], seed = 1, night = false, litRatio = 0.5, sign,
  } = spec;
  const rise = roofStyle === 'gable' ? Math.round(height * 0.3) + 5
    : roofStyle === 'hip' ? Math.round(height * 0.3) + 4 : 0;
  const p = frame(w, d, height + rise, rise + 12);
  const rand = rng(seed * 7919 + height);
  const cols = facade(wall, night);
  const roofPal = roofColor ?? cols.roof;
  const anchors = {};

  const box = isoBox(p, 0, 0, w, d, height, {
    roof: roofStyle === 'flat' ? darken(roofPal, 0.1) : cols.mid,
    sw: cols.mid, se: cols.dark,
  });
  const faces = boxFaces(0, 0, w, d, height);

  if (details.includes('band')) signBand(p, faces.sw, height, sign ?? PALETTE.sign.amber);
  windows(p, faces.sw, floors, Math.max(1, Math.round(w * 2)), height,
    { rand, night, style: windowStyle, litRatio });
  windows(p, faces.se, floors, Math.max(1, Math.round(d * 2)), height,
    { rand, night, style: windowStyle, litRatio: litRatio * 0.8 });
  if (details.includes('door')) { door(p, faces.sw, night); anchors.door = [faces.sw.ox, faces.sw.oy]; }
  if (details.includes('awning')) awning(p, faces.sw, sign ?? PALETTE.sign.rose);
  if (details.includes('balcony')) {
    balconies(p, faces.sw, floors, height);
    balconies(p, faces.se, floors, height);
  }

  if (roofStyle === 'gable') gable(p, box, rise, roofPal, night);
  else if (roofStyle === 'hip') hip(p, box, rise, roofPal, night);
  else {
    p.line(box.A[0], box.A[1], box.B[0], box.B[1], lighten(roofPal, 0.2));
    p.line(box.A[0], box.A[1], box.D[0], box.D[1], lighten(roofPal, 0.2));
    if (details.includes('kit')) roofKit(p, w, d, rand, night);
    if (details.includes('tank')) {
      isoBox(p, w / 2 - 0.3, d / 2 - 0.3, 0.6, 0.6, 7, {
        roof: PALETTE.metal.light, sw: PALETTE.metal.mid, se: PALETTE.metal.dark,
      });
    }
    if (details.includes('solar')) solarArray(p, w, d, height, night);
  }

  if (details.includes('chimney')) {
    const ch = Math.round(height * 0.5) + 8;
    const gx = w - 0.6, gy = d - 0.6;
    isoBox(p, gx, gy, 0.4, 0.4, ch, {
      roof: PALETTE.metal.mid, sw: darken(PALETTE.metal.mid, 0.12), se: PALETTE.metal.dark,
    });
    for (let i = 0; i < 3; i++) {
      p.poly(faceQuad(boxFaces(gx, gy, 0.4, 0.4, ch).sw, 0.05, ch - 6 - i * 2, 0.3, 1.2),
        PALETTE.hazard.stripe);
    }
    const tip = isoShift(gx + 0.2, gy + 0.2, height + ch);
    anchors.chimney = [tip[0], tip[1]];
  }

  p.outline(OUTLINE);
  return { painter: p, anchors, origin: p.origin };
}
