/**
 * World layout: terrain, the road lattice, three city districts, the plant and the
 * transmission network that ties them together.
 *
 * Generation is seeded and deterministic, so a screenshot, a bug report and a save all
 * describe the same map. The renderer only ever reads the arrays produced here.
 */

export type TileKind = 'grass' | 'dirt' | 'sand' | 'water' | 'forest' | 'mountain'
  | 'road' | 'plot' | 'pad';

export type WorldTile = { x: number; y: number; kind: TileKind; variant: number };

export type CatalogueEntry = {
  key: string;
  category: 'residential' | 'commercial' | 'industrial';
  tier: number;
  footprint: [number, number];
};

export type Placed = {
  id: string;
  frame: string;
  x: number;
  y: number;
  w: number;
  d: number;
  category: CatalogueEntry['category'] | 'energy';
  cityId?: string;
};

export type Pylon = { x: number; y: number; id: string };
export type PowerLine = { id: string; cityId: string; from: [number, number]; to: [number, number] };

export type Rect = { x: number; y: number; w: number; d: number };

export type WorldMap = {
  size: number;
  tiles: WorldTile[];
  placed: Placed[];
  pylons: Pylon[];
  lines: PowerLine[];
  plantGrid: { x: number; y: number };
  districtBounds: Record<string, Rect>;
};

/** Index into this list is stored in a road tile's `variant`. */
export const ROAD_FRAMES = ['road_x', 'road_y', 'road_cross',
  'road_curve_0', 'road_curve_1', 'road_curve_2', 'road_curve_3'] as const;

function makeRng(seed: number) {
  let s = (seed >>> 0) || 7;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const SIZE = 56;
const DISTRICTS: Record<string, Rect> = {
  delta: { x: 8, y: 9, w: 13, d: 12 },
  nova: { x: 33, y: 7, w: 14, d: 13 },
  harbor: { x: 20, y: 33, w: 14, d: 13 },
};
export const DISTRICT_IDS = Object.keys(DISTRICTS);
const PLANT = { x: 25, y: 19 };

/** City character decides which catalogue tiers get built, so the three cities look
 *  different by construction rather than by hand placement. */
const PROFILE: Record<string, { mix: [number, number, number]; density: number }> = {
  delta: { mix: [0.5, 0.28, 0.22], density: 0.74 },
  nova: { mix: [0.4, 0.52, 0.08], density: 0.84 },
  harbor: { mix: [0.3, 0.2, 0.5], density: 0.64 },
};

/** L-shaped route: run along x at y0, then along y at x1. */
function corridor(from: [number, number], to: [number, number]): [number, number][] {
  const [x0, y0] = from, [x1, y1] = to;
  const pts: [number, number][] = [];
  const stepX = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + stepX; x += stepX) pts.push([x, y0]);
  const stepY = y1 >= y0 ? 1 : -1;
  for (let y = y0 + stepY; y !== y1 + stepY; y += stepY) pts.push([x1, y]);
  return pts;
}

export function buildWorld(catalogue: CatalogueEntry[], seed = 20260101): WorldMap {
  const rng = makeRng(seed);
  const tiles: WorldTile[] = [];
  const index = new Map<string, number>();
  const key = (x: number, y: number) => `${x},${y}`;
  const set = (x: number, y: number, kind: TileKind, variant = 0) => {
    const at = index.get(key(x, y));
    if (at === undefined) return;
    tiles[at] = { x, y, kind, variant };
  };
  const kindOf = (x: number, y: number): TileKind | undefined =>
    tiles[index.get(key(x, y)) ?? -1]?.kind;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ridge = y < 4 && x > 6 && x < 46;
      const lake = (x - 47) ** 2 / 90 + (y - 40) ** 2 / 42 < 1;
      const river = y > 45 && x < 10 + Math.sin(y / 3) * 3;
      let kind: TileKind = 'grass';
      if (ridge) kind = 'mountain';
      else if (lake || river) kind = 'water';
      tiles.push({ x, y, kind, variant: Math.floor(rng() * 4) });
      index.set(key(x, y), tiles.length - 1);
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = tiles[index.get(key(x, y))!];
      if (t.kind === 'mountain') t.variant = rng() > 0.65 ? 1 : 0;
      else if (t.kind === 'water') t.variant = Math.floor(rng() * 4);
      else t.variant = Math.floor(rng() * 4);
    }
  }

  // Forest belts and lake shallows as patches, not per-tile noise.
  for (const [cx, cy, r] of [[12, 45, 4], [43, 17, 3], [5, 24, 3], [37, 45, 3], [30, 4, 2]] as const) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        if (kindOf(x, y) !== 'grass') continue;
        if (Math.hypot(x - cx, y - cy) > r * (0.55 + rng() * 0.65)) continue;
        set(x, y, 'forest', Math.floor(rng() * 3));
      }
    }
  }
  for (let y = 41; y <= 44; y++) {
    for (let x = 39; x <= 53; x++) if (kindOf(x, y) === 'water') set(x, y, 'sand', 0);
  }

  // Plant pad, slightly larger than the building so its yard is visible.
  for (let y = PLANT.y - 1; y <= PLANT.y + 3; y++) {
    for (let x = PLANT.x - 1; x <= PLANT.x + 4; x++) {
      if (kindOf(x, y) && kindOf(x, y) !== 'water') set(x, y, 'pad', 0);
    }
  }

  // --- roads ---------------------------------------------------------------
  const paved = new Set<string>();
  const pavedAt: [number, number][] = [];
  const pave = (x: number, y: number) => {
    const k = kindOf(x, y);
    if (!k || k === 'water' || k === 'mountain' || k === 'pad') return;
    if (paved.has(key(x, y))) return;
    paved.add(key(x, y));
    pavedAt.push([x, y]);
    set(x, y, 'road', 0);
  };

  for (const r of Object.values(DISTRICTS)) {
    for (let bx = r.x; bx <= r.x + r.w - 1; bx += 4) for (let y = r.y; y < r.y + r.d; y++) pave(bx, y);
    for (let by = r.y; by <= r.y + r.d - 1; by += 4) for (let x = r.x; x < r.x + r.w; x++) pave(x, by);
  }
  const gateOf = (r: Rect): [number, number] => [r.x + 4, r.y + 4];
  const plantGate = (r: Rect): [number, number] =>
    [PLANT.x + (r.x < PLANT.x ? -1 : 3), PLANT.y + (r.y < PLANT.y ? -1 : 3)];
  for (const r of Object.values(DISTRICTS)) {
    for (const [x, y] of corridor(gateOf(r), plantGate(r))) pave(x, y);
  }
  // Ring roads between districts so the map reads as one grid, not three islands.
  const pairs = [['delta', 'nova'], ['delta', 'harbor'], ['nova', 'harbor']] as const;
  for (const [a, b] of pairs) {
    for (const [x, y] of corridor([DISTRICTS[a].x + 8, DISTRICTS[a].y + 8],
      [DISTRICTS[b].x + 4, DISTRICTS[b].y + 10])) pave(x, y);
  }

  // Give every road tile the frame that matches its neighbours, so carriageways join.
  for (const [x, y] of pavedAt) {
    const plusX = paved.has(key(x + 1, y)) || kindOf(x + 1, y) === 'pad';
    const minusX = paved.has(key(x - 1, y)) || kindOf(x - 1, y) === 'pad';
    const plusY = paved.has(key(x, y + 1)) || kindOf(x, y + 1) === 'pad';
    const minusY = paved.has(key(x, y - 1)) || kindOf(x, y - 1) === 'pad';
    const alongX = plusX || minusX, alongY = plusY || minusY;
    let variant = 0;
    if (alongX && alongY) variant = 2;
    else if (alongY) variant = 1;
    else variant = 0;
    if (alongX && alongY) {
      // A bend joins exactly one x and one y neighbour; pick the corner they share.
      const bend = (plusX && plusY && !minusX && !minusY) ? 2
        : (plusX && minusY && !minusX && !plusY) ? 1
          : (minusX && plusY && !plusX && !minusY) ? 3
            : (minusX && minusY && !plusX && !plusY) ? 0 : -1;
      if (bend >= 0) variant = 3 + bend;
    }
    set(x, y, 'road', variant);
  }

  // --- buildings -----------------------------------------------------------
  const placed: Placed[] = [];
  const occupied = new Set<string>();
  const fits = (x: number, y: number, w: number, d: number) => {
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        const k = kindOf(x + i, y + j);
        if (!k || k === 'road' || k === 'water' || k === 'mountain' || k === 'forest'
          || k === 'pad' || k === 'sand') return false;
        if (occupied.has(key(x + i, y + j))) return false;
      }
    }
    return true;
  };

  const pool = {
    residential: catalogue.filter((c) => c.category === 'residential'),
    commercial: catalogue.filter((c) => c.category === 'commercial'),
    industrial: catalogue.filter((c) => c.category === 'industrial'),
  };
  const pick = (cat: keyof typeof pool, wantTier: number) => {
    const sorted = [...pool[cat]].sort((a, b) => Math.abs(a.tier - wantTier) - Math.abs(b.tier - wantTier));
    return sorted[Math.floor(rng() * Math.min(3, sorted.length))];
  };

  for (const [id, r] of Object.entries(DISTRICTS)) {
    const prof = PROFILE[id];
    for (let y = r.y; y < r.y + r.d; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (rng() > prof.density) continue;
        const roll = rng();
        const cat: keyof typeof pool = roll < prof.mix[0] ? 'residential'
          : roll < prof.mix[0] + prof.mix[1] ? 'commercial' : 'industrial';
        const wantTier = cat === 'industrial' ? 2 : Math.max(1, Math.min(4, Math.round(prof.density * 4.5)));
        const entry = pick(cat, wantTier);
        if (!entry) continue;
        const [w, d] = entry.footprint;
        if (!fits(x, y, w, d)) continue;
        for (let j = 0; j < d; j++) {
          for (let i = 0; i < w; i++) {
            occupied.add(key(x + i, y + j));
            set(x + i, y + j, 'plot', 0);
          }
        }
        placed.push({ id: `${id}-${placed.length}`, frame: entry.key, x, y, w, d, category: cat, cityId: id });
      }
    }
  }

  // --- transmission network -------------------------------------------------
  const pylons: Pylon[] = [];
  const lines: PowerLine[] = [];
  for (const [id, r] of Object.entries(DISTRICTS)) {
    const route = corridor(gateOf(r), [PLANT.x + 1, PLANT.y + 1]);
    const chain: Pylon[] = [];
    for (let i = 1; i < route.length; i += 5) {
      const [x, y] = route[i];
      const p = { x, y, id: `${id}-pylon-${chain.length}` };
      pylons.push(p);
      chain.push(p);
    }
    const last = route[route.length - 1];
    const tail = { x: last[0], y: last[1], id: `${id}-pylon-end` };
    pylons.push(tail);
    chain.push(tail);
    for (let i = 0; i < chain.length - 1; i++) {
      lines.push({
        id: `${id}-line-${i}`, cityId: id,
        from: [chain[i].x, chain[i].y], to: [chain[i + 1].x, chain[i + 1].y],
      });
    }
  }

  return { size: SIZE, tiles, placed, pylons, lines, plantGrid: PLANT, districtBounds: DISTRICTS };
}

export function districtRect(id: string): Rect | undefined {
  return DISTRICTS[id];
}

/** Terrain atlas frame for a ground tile. */
export function terrainFrame(t: WorldTile): string {
  switch (t.kind) {
    case 'grass': return `grass_${t.variant % 4}`;
    case 'dirt': return `dirt_${t.variant % 2}`;
    case 'sand': return 'sand_0';
    case 'water': return `water_${t.variant % 4}`;
    case 'road': return ROAD_FRAMES[Math.min(t.variant, ROAD_FRAMES.length - 1)];
    case 'plot': return 'grass_1';
    case 'pad': return 'dirt_0';
    case 'forest': return `forest_${t.variant % 3}`;
    case 'mountain': return t.variant === 1 ? 'mountain_snow' : `mountain_${t.variant % 2}`;
    default: return 'grass_0';
  }
}
