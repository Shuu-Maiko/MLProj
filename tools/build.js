/**
 * Build every shipped sprite atlas.
 *
 * Run with `npm run build` in tools/. Output goes to game/public/assets and is
 * committed as generated content: the generator is the source of truth, so a palette or
 * footprint change is a one-line edit rather than a redraw.
 *
 * The building catalogue below is also what the game samples when it lays out a city,
 * so "residential", "commercial" and "industrial" in the simulation and in the art can
 * never disagree about which sprites exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Atlas } from './sprites/atlas.js';
import { PALETTE } from './sprites/palette.js';
import * as T from './sprites/terrain.js';
import { building } from './sprites/buildings.js';
import * as E from './sprites/energy.js';
import * as V from './sprites/vehicles.js';
import * as FX from './sprites/fx.js';
import { icon, ICONS } from './sprites/ui.js';

const OUT = path.resolve(process.cwd(), '../game/public/assets');

const WALLS = {
  house: [PALETTE.houseWall, PALETTE.sand, PALETTE.shopWall, PALETTE.dirt],
  roofs: [PALETTE.houseRoof.red, PALETTE.houseRoof.brick, PALETTE.houseRoof.slate,
    PALETTE.houseRoof.teal, PALETTE.houseRoof.timber],
  shopRoofs: [PALETTE.shopRoof.blue, PALETTE.shopRoof.navy, PALETTE.shopRoof.plum, PALETTE.shopRoof.green],
  signs: [PALETTE.sign.amber, PALETTE.sign.rose, PALETTE.sign.cyan, PALETTE.sign.lime],
};

/**
 * Building catalogue: each entry becomes a day frame and a night frame.
 * `tier` is how developed the city looks; the game picks tiers by population density.
 */
export const CATALOGUE = [
  ...[0, 1, 2, 3].map((i) => ({
    key: `res_house_${i}`, category: 'residential', tier: 1, footprint: [1, 1],
    spec: { w: 1, d: 1, height: 14 + (i % 2) * 4, floors: 1 + (i > 1 ? 1 : 0),
      wall: WALLS.house[i % WALLS.house.length], roofColor: WALLS.roofs[i],
      roofStyle: i % 2 ? 'hip' : 'gable', details: i % 3 === 0 ? ['door', 'chimney'] : ['door'], seed: 31 + i },
  })),
  ...[0, 1, 2].map((i) => ({
    key: `res_villa_${i}`, category: 'residential', tier: 2, footprint: [2, 1],
    spec: { w: 2, d: 1, height: 18, floors: 2, wall: WALLS.house[(i + 1) % 4],
      roofColor: WALLS.roofs[(i + 2) % 5], roofStyle: 'gable', details: ['door', 'kit'], seed: 41 + i },
  })),
  ...[0, 1, 2, 3].map((i) => ({
    key: `res_apt_${i}`, category: 'residential', tier: 3, footprint: [2, 2],
    spec: { w: 2, d: 2, height: 34 + i * 8, floors: 3 + i, wall: WALLS.house[i % 4],
      roofColor: PALETTE.houseRoof.slate, details: ['kit', 'balcony', 'door'], seed: 51 + i, litRatio: 0.55 },
  })),
  ...[0, 1, 2].map((i) => ({
    key: `res_tower_${i}`, category: 'residential', tier: 4, footprint: [2, 2],
    spec: { w: 2, d: 2, height: 76 + i * 14, floors: 8 + i * 2, wall: PALETTE.shopWall,
      roofColor: PALETTE.metal.mid, details: ['kit', 'tank', 'balcony'], seed: 61 + i, litRatio: 0.6 },
  })),

  ...[0, 1, 2, 3].map((i) => ({
    key: `com_shop_${i}`, category: 'commercial', tier: 1, footprint: [1, 1],
    spec: { w: 1, d: 1, height: 15, floors: 1, wall: PALETTE.shopWall,
      roofColor: WALLS.shopRoofs[i], details: ['door', 'awning', 'band'],
      sign: WALLS.signs[i], seed: 71 + i },
  })),
  ...[0, 1].map((i) => ({
    key: `com_market_${i}`, category: 'commercial', tier: 2, footprint: [2, 2],
    spec: { w: 2, d: 2, height: 20, floors: 1, wall: PALETTE.shopWall,
      roofColor: WALLS.shopRoofs[i], details: ['door', 'band', 'kit'],
      sign: WALLS.signs[i + 1], seed: 81 + i },
  })),
  ...[0, 1, 2].map((i) => ({
    key: `com_office_${i}`, category: 'commercial', tier: 3, footprint: [2, 2],
    spec: { w: 2, d: 2, height: 44 + i * 16, floors: 5 + i * 2, wall: PALETTE.metal,
      roofColor: PALETTE.panel.dark, windowStyle: 'glass', details: ['kit', 'door'], seed: 91 + i, litRatio: 0.7 },
  })),
  ...[0, 1].map((i) => ({
    key: `com_mall_${i}`, category: 'commercial', tier: 3, footprint: [3, 2],
    spec: { w: 3, d: 2, height: 26, floors: 2, wall: PALETTE.shopWall,
      roofColor: PALETTE.shopRoof.blue, windowStyle: 'glass', details: ['door', 'band', 'solar', 'kit'],
      sign: PALETTE.sign.cyan, seed: 101 + i },
  })),
  ...[0, 1].map((i) => ({
    key: `com_hotel_${i}`, category: 'commercial', tier: 4, footprint: [2, 3],
    spec: { w: 2, d: 3, height: 52 + i * 12, floors: 6 + i * 2, wall: PALETTE.houseWall,
      roofColor: PALETTE.shopRoof.plum, details: ['kit', 'solar', 'band', 'balcony', 'door'],
      sign: PALETTE.sign.amber, seed: 111 + i, litRatio: 0.5 },
  })),

  ...[0, 1].map((i) => ({
    key: `ind_workshop_${i}`, category: 'industrial', tier: 1, footprint: [2, 1],
    spec: { w: 2, d: 1, height: 16, floors: 1, wall: PALETTE.metal,
      roofColor: PALETTE.rust.mid, details: ['door', 'chimney'], seed: 121 + i },
  })),
  ...[0, 1, 2].map((i) => ({
    key: `ind_factory_${i}`, category: 'industrial', tier: 2, footprint: [3, 2],
    spec: { w: 3, d: 2, height: 24 + i * 4, floors: 2, wall: PALETTE.metal,
      roofColor: PALETTE.rust.mid, details: ['chimney', 'kit', 'door'], seed: 131 + i },
  })),
  ...[0, 1].map((i) => ({
    key: `ind_warehouse_${i}`, category: 'industrial', tier: 2, footprint: [3, 2],
    spec: { w: 3, d: 2, height: 16, floors: 1, wall: PALETTE.shopWall,
      roofColor: PALETTE.metal.mid, details: ['door', 'kit'], seed: 141 + i },
  })),
  ...[0, 1].map((i) => ({
    key: `ind_complex_${i}`, category: 'industrial', tier: 3, footprint: [3, 3],
    spec: { w: 3, d: 3, height: 30 + i * 6, floors: 3, wall: PALETTE.metal,
      roofColor: PALETTE.rust.dark, details: ['chimney', 'kit', 'tank', 'door'], seed: 151 + i },
  })),
];

function buildTerrain() {
  const a = new Atlas('terrain');
  for (let i = 0; i < 4; i++) a.add(`grass_${i}`, T.grass(i + 1));
  for (let i = 0; i < 2; i++) a.add(`dirt_${i}`, T.dirt(i + 1));
  a.add('sand_0', T.sand(1));
  for (let i = 0; i < 4; i++) a.add(`water_${i}`, T.water(i));
  a.add('road_x', T.roadStraight('x'));
  a.add('road_y', T.roadStraight('y'));
  a.add('road_cross', T.roadIntersection());
  for (let i = 0; i < 4; i++) a.add(`road_curve_${i}`, T.roadCurve(i));
  for (let i = 0; i < 3; i++) a.add(`forest_${i}`, T.forest(i + 1));
  for (let i = 0; i < 2; i++) a.add(`mountain_${i}`, T.mountain(i + 1));
  a.add('mountain_snow', T.mountain(3, true));
  a.add('plot_marker', T.plotMarker());
  return a;
}

function buildBuildings(night) {
  const a = new Atlas(night ? 'buildings_night' : 'buildings');
  for (const item of CATALOGUE) {
    const { painter, origin } = building({ ...item.spec, night });
    a.add(item.key, painter, origin);
  }
  return a;
}

function buildEnergy() {
  const a = new Atlas('energy');
  for (const [key, res] of [['plant_day', E.powerPlant(false)], ['plant_night', E.powerPlant(true)],
    ['pylon', E.transmissionTower()], ['substation_day', E.substation(false)],
    ['substation_night', E.substation(true)]]) a.add(key, res.painter, res.origin);
  for (const [key, p] of [['solar_day', E.solarFarm(false)], ['solar_night', E.solarFarm(true)],
    ['battery_full', E.batteryStorage(1, false)], ['battery_half', E.batteryStorage(0.55, false)],
    ['battery_low', E.batteryStorage(0.2, false)]]) a.add(key, p, p.origin);
  // Turbines stand on a tile centre, so their anchor is the base of the tower.
  for (let f = 0; f < 8; f++) a.add(`wind_${f}`, E.windTurbine(f), { x: 32, y: 100 });
  return a;
}

function buildVehicles() {
  const a = new Atlas('vehicles');
  const kinds = ['car', 'van', 'truck', 'bus', 'service'];
  for (const k of kinds) {
    for (const h of [0, 1]) {
      for (const [suffix, night] of [['', false], ['_night', true]]) {
        const p = V.vehicle(k, h, night, h ? 'car2' : 'car1');
        a.add(`${k}${suffix}_x${h}`, p, { x: Math.round(p.w / 2), y: p.h - 2 });
      }
    }
  }
  return a;
}

function buildFx() {
  const a = new Atlas('fx');
  for (let f = 0; f < 4; f++) {
    a.add(`pulse_low_${f}`, FX.pulse(f, 0.35));
    a.add(`pulse_mid_${f}`, FX.pulse(f, 0.65));
    a.add(`pulse_high_${f}`, FX.pulse(f, 0.9));
    a.add(`pulse_crit_${f}`, FX.pulse(f, 1.2));
    a.add(`smoke_${f}`, FX.plume(f, PALETTE.road.light));
    a.add(`steam_${f}`, FX.plume(f, '#e8eef8', true));
    a.add(`spark_${f}`, FX.spark(f));
  }
  a.add('tint_tile', FX.tintTile());
  a.add('ring_select', FX.selectionRing());
  a.add('ring_hover', FX.hoverRing());
  return a;
}

function buildUi() {
  const a = new Atlas('ui');
  for (const name of Object.keys(ICONS)) a.add(name, icon(name));
  return a;
}

const atlases = [buildTerrain(), buildBuildings(false), buildBuildings(true),
  buildEnergy(), buildVehicles(), buildFx(), buildUi()];

const summary = atlases.map((a) => ({ group: a.name, ...a.write(OUT) }));
console.log(`atlases written to ${OUT}`);
for (const s of summary) console.log(`  ${s.group}: ${s.count} frames (${s.width}x${s.height})`);

fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(
  CATALOGUE.map(({ key, category, tier, footprint }) => ({ key, category, tier, footprint })), null, 2));
fs.writeFileSync(path.join(OUT, 'anchors.json'), JSON.stringify({
  plant_day: E.powerPlant(false).anchors,
  plant_night: E.powerPlant(true).anchors,
  pylon: E.transmissionTower().anchors,
  substation_day: E.substation(false).anchors,
}, null, 2));
console.log('  catalogue.json + anchors.json written');
