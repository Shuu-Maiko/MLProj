/** Isometric projection shared by the renderer and the React hit-testing helpers. */

export const TILE_W = 64;
export const TILE_H = 32;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

/** Grid corner (x, y) -> the screen pixel where a tile's north corner sits. */
export function gridToScreen(x: number, y: number) {
  return { x: (x - y) * HW, y: (x + y) * HH };
}

/** Screen pixel -> fractional grid coordinates. */
export function screenToGrid(sx: number, sy: number) {
  const gx = (sy / HH + sx / HW) / 2;
  const gy = (sy / HH - sx / HW) / 2;
  return { x: gx, y: gy };
}

/** Whole-tile index under a screen point, matching how tiles are drawn. */
export function tileAt(sx: number, sy: number) {
  const { x, y } = screenToGrid(sx, sy);
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** Painter's-order depth: anything further south/east draws on top. */
export function depthOf(x: number, y: number, bias = 0) {
  return (x + y) * 16 + bias;
}

export const ZOOM_STEPS = [0.5, 1, 2, 3, 4] as const;
