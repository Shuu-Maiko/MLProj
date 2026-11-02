/**
 * Road traffic. Vehicles are drawn on the two isometric headings a tile road can have
 * (south-east along +x, south-west along +y); the game mirrors them for the reverse
 * direction rather than storing four sprites per vehicle.
 */

import { Painter } from './painter.js';
import { PALETTE, OUTLINE, darken, lighten } from './palette.js';

const SLOPE = 0.5; // a 2:1 iso edge, so the roofline stays parallel to the road

function body(p, x, y, len, wide, tall, color, night) {
  const paint = night ? darken(color, 0.35) : color;
  // Cabin and chassis as two stacked parallelograms skewed along the road.
  const skew = len * SLOPE;
  p.poly([[x, y], [x + len, y + skew], [x + len, y + skew - tall], [x, y - tall]], paint);
  p.poly([[x, y - tall], [x + len, y + skew - tall], [x + len - wide, y + skew - tall - wide * SLOPE],
    [x - wide, y - tall - wide * SLOPE]], lighten(paint, 0.18));
  p.poly([[x + len, y + skew], [x + len, y + skew - tall], [x + len - wide, y + skew - tall - wide * SLOPE],
    [x + len - wide, y + skew - wide * SLOPE]], darken(paint, 0.28));
}

function wheels(p, x, y, len, count) {
  for (let i = 0; i < count; i++) {
    const t = 0.22 + (i * (len - 8)) / Math.max(1, count - 1);
    const wx = x + t, wy = y + t * SLOPE;
    p.rect(wx - 1, wy - 2, 3, 3, PALETTE.vehicle.tyre);
  }
}

function windows(p, x, y, tall, len, night, start = 0.45) {
  const glass = night ? PALETTE.window.lit : PALETTE.glass.day;
  for (let i = 0; i < 2; i++) {
    const u = len * (start + i * 0.22);
    p.rect(Math.round(x + u), Math.round(y + u * SLOPE) - tall + 2, 4, 3, glass);
  }
}

/**
 * One vehicle. `heading` 0 travels south-east, 1 travels south-west.
 * kind: car | van | truck | bus | service
 */
export function vehicle(kind, heading = 0, night = false, colorKey = 'car1') {
  const dims = { car: [18, 7, 6], van: [20, 8, 8], truck: [26, 9, 9], bus: [28, 9, 9], service: [22, 8, 8] }[kind];
  const [len, wide, tall] = dims;
  const pad = 4;
  const p = new Painter(len + wide + pad * 2, Math.round((len + wide) * SLOPE) + tall + pad * 2 + 4);
  const x0 = pad + (heading === 1 ? wide : 0);
  const y0 = p.h - pad - 3;
  const color = kind === 'truck' ? PALETTE.vehicle.truck
    : kind === 'bus' ? PALETTE.vehicle.car3
      : kind === 'service' ? PALETTE.hazard.orange
        : PALETTE.vehicle[colorKey];

  body(p, x0, y0, len, wide, tall, color, night);
  if (kind === 'truck') {
    // Flat-bed truck: cab at the front, lower grey load bed behind.
    body(p, x0, y0, 8, wide, tall, PALETTE.vehicle.van, night);
    p.poly([[x0 + 9, y0 + 9 * SLOPE - 4], [x0 + len, y0 + len * SLOPE - 4],
      [x0 + len, y0 + len * SLOPE - 6], [x0 + 9, y0 + 9 * SLOPE - 6]], PALETTE.metal.mid);
  }
  wheels(p, x0, y0, len, kind === 'truck' || kind === 'bus' ? 3 : 2);
  windows(p, x0, y0, tall, len, night, kind === 'car' ? 0.4 : 0.3);
  if (night) {
    const lampX = x0 + len, lampY = y0 + len * SLOPE - tall + 2;
    p.rect(lampX - 1, lampY, 2, 2, PALETTE.energy.glow);
  }
  p.outline(OUTLINE);
  if (heading === 1) return mirrorX(p);
  return p;
}

function mirrorX(src) {
  const out = new Painter(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const a = src.alphaAt(x, y);
      if (!a) continue;
      const i = (y * src.w + x) * 4;
      out.setRaw(src.w - 1 - x, y,
        `#${[src.data[i], src.data[i + 1], src.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`, a);
    }
  }
  return out;
}
