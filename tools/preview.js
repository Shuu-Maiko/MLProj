/**
 * Contact sheet renderer for art review.
 *
 * Draws a numbered sample of every sprite so a geometry or palette mistake shows up
 * across the whole set at once instead of only inside the running game. The console
 * prints which number is which frame. Output goes to tools/out/, never into shipped
 * assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Painter, TILE_W, TILE_H, isoBox } from './sprites/painter.js';
import { PALETTE, OUTLINE } from './sprites/palette.js';
import { building } from './sprites/buildings.js';
import * as E from './sprites/energy.js';
import * as T from './sprites/terrain.js';

const COLS = 6;

// 3x5 digit bitmaps, row-major, 1 = ink. Enough to label a contact sheet.
const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001111',
};

function drawNumber(p, n, x, y, color) {
  String(n).padStart(2, '0').split('').forEach((ch, i) => {
    const bits = DIGITS[ch];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) if (bits[r * 3 + c] === '1') p.set(x + i * 5 + c, y + r, color);
    }
  });
}

function sheet(samples, file) {
  const painted = samples.map((s) => ({ ...s, p: s.paint() }));
  // Cells size to the largest sprite so nothing is clipped in a review sheet.
  const cw = Math.max(...painted.map((s) => s.p.w)) + 12;
  const ch = Math.max(...painted.map((s) => s.p.h)) + 12;
  const rows = Math.ceil(painted.length / COLS);
  const w = COLS * cw, h = rows * ch;
  const out = new Painter(w, h);
  out.rect(0, 0, w, h, '#0d1220');
  painted.forEach(({ p }, i) => {
    const cx = (i % COLS) * cw, cy = Math.floor(i / COLS) * ch;
    out.rect(cx, cy, cw, ch, '#131a2b');
    // Ground-line alignment: sit each sprite on the cell floor so heights compare.
    out.paste(p, Math.round(cx + (cw - p.w) / 2), cy + ch - p.h - 6);
    drawNumber(out, i, cx + 4, cy + 4, PALETTE.ui.cyan);
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = new PNG({ width: w, height: h });
  out.data.forEach((v, k) => { png.data[k] = v; });
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log(`wrote ${file} (${w}x${h}, cell ${cw}x${ch})`);
  painted.forEach((s, i) => console.log(`  ${i} ${s.name}`));
}

/** A 1x1 house proving iso box geometry, face shading and outline all line up. */
function testHouse() {
  const p = new Painter(TILE_W + 8, TILE_H + 48);
  p.paste(T.grass(2), 4, p.h - TILE_H - 4);
  isoBox(p, 0.5, 0.5, 1, 1, 26, {
    roof: PALETTE.houseRoof.red,
    sw: PALETTE.houseWall.mid,
    se: PALETTE.houseWall.dark,
  });
  p.outline(OUTLINE);
  return p;
}

/** Building sprites are drawn standalone; the atlas records their anchor offsets. */
const B = (spec) => () => building(spec).painter;

const samples = [
  { name: 'grass_1', paint: () => T.grass(1) },
  { name: 'grass_2', paint: () => T.grass(2) },
  { name: 'dirt_1', paint: () => T.dirt(3) },
  { name: 'sand_1', paint: () => T.sand(4) },
  { name: 'water_0', paint: () => T.water(0) },
  { name: 'water_1', paint: () => T.water(1) },
  { name: 'water_2', paint: () => T.water(2) },
  { name: 'water_3', paint: () => T.water(3) },
  { name: 'road_x', paint: () => T.roadStraight('x') },
  { name: 'road_y', paint: () => T.roadStraight('y') },
  { name: 'road_cross', paint: () => T.roadIntersection() },
  { name: 'road_curve_0', paint: () => T.roadCurve(0) },
  { name: 'road_curve_1', paint: () => T.roadCurve(1) },
  { name: 'road_curve_2', paint: () => T.roadCurve(2) },
  { name: 'road_curve_3', paint: () => T.roadCurve(3) },
  { name: 'forest_1', paint: () => T.forest(7) },
  { name: 'mountain_1', paint: () => T.mountain(8) },
  { name: 'mountain_snow', paint: () => T.mountain(9, true) },
  { name: 'plot_marker', paint: () => T.plotMarker() },
  { name: 'test_house', paint: testHouse },
  {
    name: 'res_house_gable',
    paint: B({ w: 1, d: 1, height: 16, floors: 1, wall: PALETTE.houseWall,
      roofColor: PALETTE.houseRoof.red, roofStyle: 'gable', details: ['door'], seed: 3 }),
  },
  {
    name: 'res_house_hip',
    paint: B({ w: 1, d: 1, height: 18, floors: 2, wall: PALETTE.houseWall,
      roofColor: PALETTE.houseRoof.teal, roofStyle: 'hip', details: ['door', 'chimney'], seed: 5 }),
  },
  {
    name: 'res_apt_4',
    paint: B({ w: 2, d: 2, height: 40, floors: 4, wall: PALETTE.houseWall,
      roofColor: PALETTE.houseRoof.slate, details: ['kit', 'balcony', 'door'], seed: 8, litRatio: 0.6 }),
  },
  {
    name: 'res_tower_8_night',
    paint: B({ w: 2, d: 2, height: 78, floors: 8, wall: PALETTE.shopWall,
      roofColor: PALETTE.metal.mid, details: ['kit', 'tank', 'balcony'], seed: 11,
      night: true, litRatio: 0.55 }),
  },
  {
    name: 'com_shop',
    paint: B({ w: 1, d: 1, height: 16, floors: 1, wall: PALETTE.shopWall,
      roofColor: PALETTE.shopRoof.blue, details: ['door', 'awning', 'band'],
      sign: PALETTE.sign.rose, seed: 13 }),
  },
  {
    name: 'com_office_glass_night',
    paint: B({ w: 2, d: 2, height: 64, floors: 7, wall: PALETTE.metal,
      roofColor: PALETTE.panel.dark, windowStyle: 'glass', details: ['kit', 'door'],
      seed: 17, night: true, litRatio: 0.7 }),
  },
  {
    name: 'ind_factory',
    paint: B({ w: 3, d: 2, height: 26, floors: 2, wall: PALETTE.metal,
      roofColor: PALETTE.rust.mid, details: ['chimney', 'kit', 'door'], seed: 19 }),
  },
  {
    name: 'com_hotel_solar_night',
    paint: B({ w: 2, d: 3, height: 52, floors: 6, wall: PALETTE.houseWall,
      roofColor: PALETTE.shopRoof.plum, details: ['kit', 'solar', 'band', 'balcony'],
      sign: PALETTE.sign.cyan, seed: 23, night: true, litRatio: 0.45 }),
  },
  { name: 'power_plant', paint: () => E.powerPlant(false).painter },
  { name: 'power_plant_night', paint: () => E.powerPlant(true).painter },
  { name: 'pylon', paint: () => E.transmissionTower().painter },
  { name: 'substation', paint: () => E.substation(false).painter },
  { name: 'substation_night', paint: () => E.substation(true).painter },
  { name: 'solar_farm', paint: () => E.solarFarm(false) },
  { name: 'wind_t0', paint: () => E.windTurbine(0) },
  { name: 'wind_t3', paint: () => E.windTurbine(3) },
  { name: 'battery', paint: () => E.batteryStorage(0.66, false) },
  { name: 'cooling_tower', paint: () => {
      const p = new Painter(64, 64);
      E.coolingTower(p, 32, 56, 40, false);
      p.outline(OUTLINE);
      return p;
    } },
];

sheet(samples, path.join(process.cwd(), 'out', 'preview-terrain.png'));
