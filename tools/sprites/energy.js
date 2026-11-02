/**
 * Energy infrastructure: the power plant and everything that carries its output.
 *
 * These are the assets the game is about, so they carry more detail than generic
 * buildings. The plant is composed from parts (turbine hall, boiler house, chimneys,
 * cooling towers, switchyard) so it reads as a landmark at any zoom and so its animated
 * anchors — where steam and power lines leave the building — are known, not guessed.
 */

import { Painter, isoBox, boxFaces, faceQuad, HW, HH } from './painter.js';
import { PALETTE, OUTLINE, darken, lighten, nightify } from './palette.js';
import { frame } from './buildings.js';

const M = PALETTE.metal;
const H = PALETTE.hazard;
const C = PALETTE.cable;

function box(p, gx, gy, w, d, h, tint = {}) {
  isoBox(p, gx, gy, w, d, h, {
    roof: tint.roof ?? M.light, sw: tint.sw ?? M.mid, se: tint.se ?? M.dark,
  });
}

/** Horizontal vent slats across a wall — what makes a grey box read as machinery. */
function louvres(p, face, v0, v1, step, color) {
  for (let v = v0; v < v1; v += step) {
    p.poly(faceQuad(face, 0.08, v, face.len - 0.16, 1.2), color);
  }
}

/** Return the screen position of the chimney mouth so the game can emit plumes there. */
function chimney(p, gx, gy, size, height, night) {
  const f = boxFaces(gx, gy, size, size, height);
  isoBox(p, gx, gy, size, size, height, {
    roof: night ? nightify(M.mid, 0.5) : M.mid,
    sw: night ? nightify(M.light, 0.5) : M.light,
    se: night ? nightify(M.dark, 0.5) : M.dark,
  });
  for (let i = 0; i < 3; i++) {
    const v = height - 5 - i * 7;
    const band = i === 1 ? H.orange : PALETTE.road.mark;
    p.poly(faceQuad(f.sw, 0.03, v, size - 0.06, 2.5), night ? nightify(band, 0.5) : band);
    p.poly(faceQuad(f.se, 0.03, v, size - 0.06, 2.5), night ? nightify(band, 0.6) : darken(band, 0.18));
  }
  return [(gx + size / 2 - gy - size / 2) * HW, (gx + gy + size) * HH - height];
}

/**
 * Hyperboloid cooling tower drawn as stacked diamonds; the waist sits at ~55% height,
 * which is the silhouette everyone recognises. Returns the rim anchor for steam.
 */
export function coolingTower(p, cx, cy, height, night = false) {
  const shell = night ? nightify(M.mid, 0.5) : M.mid;
  const lit = night ? nightify(M.light, 0.45) : lighten(M.light, 0.1);
  const shade = night ? nightify(M.dark, 0.5) : darken(M.dark, 0.1);
  const rings = 10;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const flare = 0.6 + 0.6 * Math.pow(Math.abs(t - 0.55) / 0.55, 1.8);
    const rw = Math.round(12 * flare);
    const rh = Math.round(6 * flare);
    const y = cy - Math.round(t * height);
    p.poly([[cx, y - rh], [cx + rw, y], [cx, y + rh], [cx - rw, y]], i % 2 ? shell : shade);
    p.line(cx - rw, y, cx + rw, y, lit);
  }
  const rim = Math.round(12 * (0.6 + 0.6));
  p.poly([[cx, cy - height - 3], [cx + rim * 0.6, cy - height], [cx, cy - height + 3],
    [cx - rim * 0.6, cy - height]], night ? PALETTE.night.shadow : PALETTE.road.dark);
  return [cx, cy - height];
}

/** The central power plant: 4 x 3 tiles plus its animation anchors. */
export function powerPlant(night = false) {
  const p = frame(4, 3, 48, 64, 10);
  const wall = night ? nightify(M.mid, 0.5) : M.mid;
  const wallDark = darken(wall, 0.2);

  // Turbine hall: long low block with a sawtooth roof.
  isoBox(p, 0.15, 0.15, 2.7, 1.6, 20, { roof: wall, sw: wall, se: wallDark });
  const hallSw = boxFaces(0.15, 0.15, 2.7, 1.6, 20).sw;
  const hallSe = boxFaces(0.15, 0.15, 2.7, 1.6, 20).se;
  louvres(p, hallSw, 5, 16, 5, night ? PALETTE.night.shadow : PALETTE.road.dark);
  louvres(p, hallSe, 5, 16, 5, darken(PALETTE.road.dark, 0.08));
  for (let i = 0; i < 4; i++) {
    const gx = 0.25 + i * 0.66;
    const base = [(gx - 1.75) * HW, (gx + 1.75) * HH - 20];
    const apex = [(gx + 0.33 - 1.75) * HW, (gx + 0.33 + 1.75) * HH - 25];
    const far = [(gx + 0.66 - 1.75) * HW, (gx + 0.66 + 1.75) * HH - 20];
    p.poly([base, apex, far], night ? nightify(M.light, 0.5) : M.light);
    p.line(base[0], base[1], apex[0], apex[1], night ? PALETTE.energy.glow : PALETTE.glass.day);
  }

  // Boiler house: taller block behind the hall.
  isoBox(p, 0.15, 1.95, 2.7, 1.0, 32, { roof: lighten(wall, 0.06), sw: wall, se: wallDark });
  const boiler = boxFaces(0.15, 1.95, 2.7, 1.0, 32);
  louvres(p, boiler.sw, 8, 26, 6, night ? PALETTE.night.shadow : PALETTE.road.dark);
  for (let i = 0; i < 7; i++) {
    p.poly(faceQuad(boiler.se, 0.15 + i * 0.36, 18, 0.2, 6),
      night ? PALETTE.window.lit : PALETTE.glass.day);
  }

  const ch1 = chimney(p, 2.85, 2.45, 0.42, 46, night);
  const ch2 = chimney(p, 3.4, 2.0, 0.42, 40, night);
  const t1 = coolingTower(p, Math.round((1.0 - 2.6) * HW), Math.round((1.0 + 2.6) * HH) - 40, 30, night);
  const t2 = coolingTower(p, Math.round((2.2 - 2.9) * HW), Math.round((2.2 + 2.9) * HH) - 30, 24, night);

  // Switchyard apron: transformers and the gantry where lines leave the site.
  box(p, 0.3, 0.35, 0.5, 0.5, 8, { roof: H.yellow, sw: H.orange, se: darken(H.orange, 0.25) });
  box(p, 1.05, 0.3, 0.5, 0.5, 7, { roof: H.yellow, sw: H.orange, se: darken(H.orange, 0.25) });
  for (const gx of [1.85, 2.55]) {
    const top = [(gx - 0.45) * HW, (gx + 0.45) * HH - 22];
    const base = [(gx - 0.45) * HW, (gx + 0.45) * HH - 4];
    p.line(base[0], base[1], top[0], top[1], C.mid);
    p.line(top[0] - 5, top[1], top[0] + 5, top[1] + 3, C.light);
    p.rect(top[0] - 1, top[1] - 3, 3, 4, PALETTE.energy.bright);
  }
  const g1 = [(1.85 - 0.45) * HW, (1.85 + 0.45) * HH - 22];
  const g2 = [(2.55 - 0.45) * HW, (2.55 + 0.45) * HH - 22];
  p.line(g1[0], g1[1] - 2, g2[0], g2[1] - 2, C.light);
  const outlet = [(1.4 - 0.45) * HW, (1.4 + 0.45) * HH - 20];

  // Hazard apron along the front edge ties the composition together.
  const apron = boxFaces(0, 2.9, 3.9, 0.14, 0).corners;
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8, t1 = (i + 0.55) / 8;
    const lerp = (u) => [
      apron.d[0] + (apron.c[0] - apron.d[0]) * u,
      apron.d[1] + (apron.c[1] - apron.d[1]) * u,
    ];
    const [ax, ay] = lerp(t0), [bx, by] = lerp(t1);
    p.poly([[ax, ay], [bx, by], [bx + 2, by + 1], [ax + 2, ay + 1]], i % 2 ? H.yellow : H.stripe);
  }

  p.outline(OUTLINE);
  return {
    painter: p,
    origin: p.origin,
    anchors: {
      smoke: [[ch1[0], ch1[1]], [ch2[0], ch2[1]]],
      steam: [t1, t2],
      outlet: [outlet[0], outlet[1]],
    },
  };
}

/** Lattice pylon. Cable attachment points are returned for the line renderer. */
export function transmissionTower() {
  const p = new Painter(60, 104);
  p.translate(30, 96);
  for (const side of [-1, 1]) {
    p.line(side * 11, 0, side * 3, -74, C.mid);
  }
  p.line(-11, 0, 11, 0, C.dark);
  for (let i = 0; i < 7; i++) {
    const y0 = -i * 10.5, y1 = -(i + 1) * 10.5;
    const w0 = 11 - i * 1.15, w1 = 11 - (i + 1) * 1.15;
    p.line(-w0, y0, w1, y1, C.light);
    p.line(w0, y0, -w1, y1, C.light);
    p.line(-w1, y1, w1, y1, C.mid);
  }
  p.line(-19, -64, 19, -64, C.mid);
  p.line(-14, -74, 14, -74, C.mid);
  p.line(-8, -84, 8, -84, C.mid);
  p.rect(-1, -92, 3, 10, C.dark);
  const arms = [[-19, -64], [0, -74], [19, -64]];
  for (const [x, y] of arms) {
    p.rect(x - 1, y - 4, 3, 5, PALETTE.energy.bright);
  }
  p.outline(OUTLINE);
  const origin = { x: 30, y: 96 };
  p.origin = origin;
  return { painter: p, origin, anchors: { left: arms[0], mid: arms[1], right: arms[2], top: [0, -92] } };
}

/** Grid substation on a 2x2 plot. */
export function substation(night = false) {
  const p = frame(2, 2, 20, 24, 6);
  const yard = boxFaces(0, 0, 2, 2, 0).corners;
  p.poly([yard.a, yard.b, yard.c, yard.d],
    night ? nightify(PALETTE.road.light, 0.5) : lighten(PALETTE.road.light, 0.1));
  for (const [gx, gy] of [[0.2, 0.2], [1.1, 0.2], [0.2, 1.1]]) {
    box(p, gx, gy, 0.62, 0.62, 11, { roof: M.light, sw: M.mid, se: M.dark });
    box(p, gx + 0.18, gy + 0.18, 0.28, 0.28, 16, {
      roof: H.yellow, sw: H.orange, se: darken(H.orange, 0.2),
    });
    louvres(p, boxFaces(gx, gy, 0.62, 0.62, 11).sw, 2, 9, 2.5, PALETTE.road.dark);
  }
  isoBox(p, 1.15, 1.15, 0.7, 0.7, 13, {
    roof: PALETTE.shopWall.light, sw: PALETTE.shopWall.mid, se: PALETTE.shopWall.dark,
  });
  const hut = boxFaces(1.15, 1.15, 0.7, 0.7, 13);
  p.poly(faceQuad(hut.sw, 0.15, 4, 0.4, 6), night ? PALETTE.window.lit : PALETTE.window.day);
  for (let i = 0; i < 5; i++) {
    const f = boxFaces(0, 1.95, 2, 0.06, 9);
    p.poly(faceQuad(f.sw, i * 0.45, 0, 0.07, 9), nightify(PALETTE.road.light, night ? 0.4 : 0));
  }
  p.outline(OUTLINE);
  return { painter: p, origin: p.origin, anchors: { outlet: [-0.2 * HW, -1 * HH] } };
}

/** Solar farm on a 3x2 plot: rows of panels tilted toward the sun. */
export function solarFarm(night = false) {
  const p = frame(3, 2, 12, 16, 6);
  const g = boxFaces(0, 0, 3, 2, 0).corners;
  p.poly([g.a, g.b, g.c, g.d], night ? nightify(PALETTE.dirt.mid, 0.5) : PALETTE.dirt.mid);
  const blue = night ? nightify(PALETTE.panel.mid, 0.55) : PALETTE.panel.mid;
  const sheen = night ? PALETTE.panel.dark : PALETTE.panel.light;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const gx = 0.12 + c * 0.95, gy = 0.12 + r * 0.46;
      const lo = gy + 0.4;
      const a = [(gx - lo) * HW, (gx + gy) * HH - 3];
      const b = [(gx + 0.82 - lo) * HW, (gx + 0.82 + gy) * HH - 3];
      const d = [(gx + 0.82 - gy) * HW, (gx + 0.82 + gy) * HH - 9];
      const e = [(gx - gy) * HW, (gx + gy) * HH - 9];
      p.poly([a, b, d, e], blue);
      p.line(a[0], a[1], e[0], e[1], sheen);
      p.line(b[0], b[1], d[0], d[1], darken(sheen, 0.25));
      if (!night) p.line(e[0], e[1], d[0], d[1], lighten(blue, 0.3));
    }
  }
  p.outline(OUTLINE);
  return p;
}

/** Wind turbine; `rotor` is the blade phase in eighths of a turn. */
export function windTurbine(rotor = 0) {
  const p = new Painter(64, 108);
  p.translate(32, 100);
  p.line(-2, 0, 0, -74, PALETTE.road.light);
  p.line(2, 0, 1, -74, PALETTE.road.dark);
  p.rect(-3, -4, 7, 4, PALETTE.road.mid);
  const hub = [0, -76];
  p.rect(hub[0] - 2, hub[1] - 2, 5, 5, PALETTE.metal.light);
  for (let b = 0; b < 3; b++) {
    const ang = ((rotor / 8) + b / 3) * Math.PI * 2;
    const len = 26;
    const ex = hub[0] + Math.cos(ang) * len;
    const ey = hub[1] + Math.sin(ang) * len * 0.72;
    p.line(hub[0], hub[1], ex, ey, PALETTE.shopWall.light);
    p.line(hub[0] + 1, hub[1], ex + 1, ey, PALETTE.road.light);
  }
  p.outline(OUTLINE);
  return p;
}

/** Battery storage: container blocks with a charge-state strip. */
export function batteryStorage(level = 0.6, night = false) {
  const p = frame(2, 1, 14, 16, 6);
  for (let i = 0; i < 3; i++) {
    const gx = 0.1 + i * 0.62;
    isoBox(p, gx, 0.15, 0.55, 0.7, 10, {
      roof: night ? nightify(M.light, 0.5) : M.light,
      sw: night ? nightify(M.mid, 0.5) : M.mid,
      se: darken(M.dark, night ? 0.1 : 0),
    });
    const f = boxFaces(gx, 0.15, 0.55, 0.7, 10).sw;
    const on = (i + 1) / 3 <= level;
    p.poly(faceQuad(f, 0.08, 4, 0.4, 3),
      on ? (night ? PALETTE.energy.glow : PALETTE.ui.green) : PALETTE.road.dark);
  }
  p.outline(OUTLINE);
  return p;
}
