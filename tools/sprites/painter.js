/**
 * Crisp pixel raster used by every sprite generator.
 *
 * Fills are integer scanline polygons rather than canvas paths: an anti-aliased
 * renderer would put half-lit pixels along the isometric edges and the whole point of
 * this pipeline is that a 64x32 tile has hard, single-pixel boundaries at any zoom.
 */

import { OUTLINE, rgb } from './palette.js';

export const TILE_W = 64;
export const TILE_H = 32;
export const HW = TILE_W / 2; // 32: screen dx for one grid step in x
export const HH = TILE_H / 2; // 16: screen dy for one grid step in x

/** Grid (gx, gy) -> screen position, y growing downward. */
export function isoPoint(gx, gy) {
  return [(gx - gy) * HW, (gx + gy) * HH];
}

export class Painter {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.data = new Uint8Array(width * height * 4);
    this.tx = 0;
    this.ty = 0;
  }

  /** Shift all subsequent drawing. Lets a sprite be authored in world coordinates
   *  and then framed inside a canvas that is sized to fit it. */
  translate(dx, dy) {
    this.tx = Math.round(dx);
    this.ty = Math.round(dy);
    return this;
  }

  get empty() {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i]) return false;
    return true;
  }

  set(x, y, color, alpha = 255) {
    this.setRaw(Math.round(x) + this.tx, Math.round(y) + this.ty, color, alpha);
  }

  /** Device-pixel write that ignores the current translate, for blits and outlines. */
  setRaw(x, y, color, alpha = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = rgb(color);
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = alpha;
  }

  alphaAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  /** Horizontal run, the cheapest primitive for facade banding. */
  hline(x, y, len, color) {
    for (let i = 0; i < len; i++) this.set(x + i, y, color);
  }

  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Even-odd scanline fill of a closed polygon. */
  poly(points, color) {
    // Vertices are converted to device space first: clamping the scan range before
    // the translate was applied threw away every roof, since those sit at negative y.
    const pts = points.map(([x, y]) => [Math.round(x) + this.tx, Math.round(y) + this.ty]);
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    for (let y = Math.max(0, minY); y <= Math.min(this.h - 1, maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.round(xs[k]), b = Math.round(xs[k + 1]) - 1;
        for (let x = Math.max(0, a); x <= Math.min(this.w - 1, b); x++) this.setRaw(x, y, color);
      }
    }
  }

  diamond(cx, cy, color, w = TILE_W, h = TILE_H) {
    this.poly([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]], color);
  }

  /**
   * Stroke the four edges of a diamond with separate colours. Kerbs and ground rims
   * go through this rather than hand-rolled loops, which is how the first terrain
   * pass ended up drawing streaks along the wrong diagonal.
   */
  diamondEdges(cx, cy, colors, w = TILE_W, h = TILE_H) {
    const n = [cx, cy - h / 2], e = [cx + w / 2, cy], s = [cx, cy + h / 2], west = [cx - w / 2, cy];
    if (colors.nw) this.line(west[0], west[1], n[0], n[1], colors.nw);
    if (colors.ne) this.line(n[0], n[1], e[0], e[1], colors.ne);
    if (colors.se) this.line(e[0], e[1], s[0], s[1], colors.se);
    if (colors.sw) this.line(s[0], s[1], west[0], west[1], colors.sw);
  }

  /** 1 px silhouette outline; runs after the body is drawn so edges stay uniform. */
  outline(color = OUTLINE) {
    const marks = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y)) continue;
        const near = this.alphaAt(x - 1, y) || this.alphaAt(x + 1, y)
          || this.alphaAt(x, y - 1) || this.alphaAt(x, y + 1);
        if (near) marks.push([x, y]);
      }
    }
    for (const [x, y] of marks) this.setRaw(x, y, color);
  }

  paste(other, dx, dy) {
    for (let y = 0; y < other.h; y++) {
      for (let x = 0; x < other.w; x++) {
        const a = other.alphaAt(x, y);
        if (!a) continue;
        const i = (y * other.w + x) * 4;
        this.setRaw(dx + x, dy + y, `#${[other.data[i], other.data[i + 1], other.data[i + 2]]
          .map((v) => v.toString(16).padStart(2, '0')).join('')}`, a);
      }
    }
  }

  /** Add a parallel 1px edge highlight running along one iso axis. */
  isoStrip(ox, oy, axis, length, color) {
    for (let i = 0; i < length; i++) this.set(ox + axis[0] * i, oy + axis[1] * i, color);
  }
}

/**
 * Parallelogram on a building face.
 * face.origin: screen point of the face's lower-left corner
 * face.axis:    screen delta per unit along the face's horizontal ( [+HW,+HH] or [+HW,-HH] )
 * u/v:          position along the face and up from its base
 */
export function faceQuad(face, u, v, span, height) {
  const { ox, oy, ax, ay } = face;
  return [
    [ox + ax * u, oy + ay * u - v],
    [ox + ax * (u + span), oy + ay * (u + span) - v],
    [ox + ax * (u + span), oy + ay * (u + span) - (v + height)],
    [ox + ax * u, oy + ay * u - (v + height)],
  ];
}

/**
 * Isometric box: footprint in tiles, height in pixels measured upward.
 * Roof is the lightest face, the south-west face mid, the south-east face darkest —
 * that ordering is what makes every building read as lit from the same north-west sun.
 */
export function isoBox(p, gx, gy, wTiles, dTiles, height, colors) {
  const a = isoPoint(gx, gy);
  const b = isoPoint(gx + wTiles, gy);
  const c = isoPoint(gx + wTiles, gy + dTiles);
  const d = isoPoint(gx, gy + dTiles);
  const top = ([x, y]) => [x, y - height];
  const A = top(a), B = top(b), C = top(c), D = top(d);

  p.poly([D, C, c, d], colors.sw);   // south-west face
  p.poly([C, B, b, c], colors.se);   // south-east face
  p.poly([A, B, C, D], colors.roof); // roof
  return { a, b, c, d, A, B, C, D };
}

/**
 * Face descriptors for the two visible walls, ready for faceQuad().
 * Origins sit at ground level and `v` grows upward, so a window at (u, v) lands the
 * same way on every building whatever its footprint. `u` is measured in tiles: the
 * axis vector is one tile of screen travel, so `len` is the face width in tiles.
 */
export function boxFaces(gx, gy, wTiles, dTiles, height) {
  const a = isoPoint(gx, gy);
  const b = isoPoint(gx + wTiles, gy);
  const c = isoPoint(gx + wTiles, gy + dTiles);
  const d = isoPoint(gx, gy + dTiles);
  const lift = ([x, y]) => [x, y - height];
  return {
    sw: { ox: d[0], oy: d[1], ax: HW, ay: HH, len: wTiles, tiles: wTiles },
    se: { ox: c[0], oy: c[1], ax: HW, ay: -HH, len: dTiles, tiles: dTiles },
    corners: { a, b, c, d, A: lift(a), B: lift(b), C: lift(c), D: lift(d) },
  };
}
