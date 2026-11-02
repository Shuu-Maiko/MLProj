/**
 * UI iconography: one 32x32 plate per tool, indicator, overlay and event.
 *
 * Icons are drawn from the same palette and outline weight as the world sprites so the
 * interface does not look like it came from a different game. Each glyph is two or three
 * shapes at most — readable at 1x, which is what a handheld-era HUD needs.
 */

import { Painter } from './painter.js';
import { PALETTE, OUTLINE, darken, lighten } from './palette.js';

const U = PALETTE.ui;
const SIZE = 32;

function plate(kind = 'button') {
  const p = new Painter(SIZE, SIZE);
  const fill = kind === 'panel' ? U.navyMid : U.navy;
  p.rect(2, 2, SIZE - 4, SIZE - 4, fill);
  p.rect(2, 2, SIZE - 4, 1, U.navyLight);
  p.rect(2, SIZE - 3, SIZE - 4, 1, darken(U.navy, 0.4));
  p.rect(2, 2, 1, SIZE - 4, U.navyLight);
  p.rect(SIZE - 3, 2, 1, SIZE - 4, darken(U.navy, 0.4));
  return p;
}

function px(p, x, y, c) { p.rect(x + 4, y + 4, 1, 1, c); }
function bar(p, x, y, w, h, c) { p.rect(x + 4, y + 4, w, h, c); }

/** Chunky pixel circle, used for gauges, suns and lamps. */
function disc(p, cx, cy, r, c) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) px(p, cx + x, cy + y, c);
    }
  }
}

function ring(p, cx, cy, r, c) {
  for (let a = 0; a < 360; a += 6) {
    const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * r);
    const y = Math.round(cy + Math.sin((a * Math.PI) / 180) * r);
    px(p, x, y, c);
  }
}

function diag(p, x0, y0, x1, y1, c, thick = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    p.rect(x + 4, y + 4, thick, thick, c);
  }
}

const BOLT = (p, c = PALETTE.energy.bright) => {
  const pts = [[7, 1], [3, 9], [6, 9], [4, 15], [10, 6], [7, 6], [9, 1]];
  for (let i = 0; i < pts.length - 1; i++) diag(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, 2);
  bar(p, 4, 6, 4, 3, c);
};

const HOUSE = (p, wall = PALETTE.houseWall.mid, roof = PALETTE.houseRoof.red) => {
  for (let x = 0; x < 12; x++) {
    const y = Math.max(0, 5 - Math.abs(x - 5.5) * 1.1);
    bar(p, x, Math.round(5 - y), 1, Math.max(1, Math.round(y)), roof);
  }
  bar(p, 2, 6, 9, 7, wall);
  bar(p, 5, 9, 3, 4, PALETTE.wood.dark);
  bar(p, 3, 8, 2, 2, PALETTE.window.day);
};

const TOWER = (p, c = U.cyan) => {
  diag(p, 4, 15, 8, 1, c, 1);
  diag(p, 12, 15, 8, 1, c, 1);
  for (let y = 3; y < 15; y += 3) bar(p, 5 + Math.round((14 - y) / 4), y, Math.max(2, 8 - Math.round((14 - y) / 3)), 1, c);
  bar(p, 3, 4, 11, 1, c);
  bar(p, 5, 2, 7, 1, c);
};

const CAR = (p, c = PALETTE.vehicle.car1) => {
  bar(p, 2, 8, 13, 4, c);
  bar(p, 5, 6, 6, 3, lighten(c, 0.2));
  bar(p, 6, 7, 4, 2, PALETTE.glass.day);
  bar(p, 4, 12, 2, 2, PALETTE.vehicle.tyre);
  bar(p, 11, 12, 2, 2, PALETTE.vehicle.tyre);
};

const CHART = (p, c = U.cyan) => {
  bar(p, 2, 2, 1, 13, U.textDim);
  bar(p, 2, 14, 13, 1, U.textDim);
  const line = [[3, 12], [6, 8], [8, 10], [11, 4], [14, 6]];
  for (let i = 0; i < line.length - 1; i++) diag(p, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], c, 1);
  for (const [x, y] of line) px(p, x, y, PALETTE.energy.bright);
};

const CLOUD = (p, c = U.text) => {
  disc(p, 6, 9, 3, c); disc(p, 10, 8, 4, c); disc(p, 13, 10, 3, c);
  bar(p, 4, 11, 11, 3, c);
};

const SUN = (p, c = PALETTE.energy.bright) => {
  disc(p, 8, 8, 3, c);
  for (const [dx, dy] of [[0, -6], [0, 6], [-6, 0], [6, 0], [-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    px(p, 8 + dx, 8 + dy, c);
  }
};

const DROP = (p, c = PALETTE.water.high) => {
  for (let y = 0; y < 6; y++) bar(p, 8 - Math.round(y / 2), 4 + y, Math.max(1, y), 1, c);
};

const FLAME = (p) => {
  const c = PALETTE.hazard.orange;
  for (let y = 0; y < 8; y++) {
    const w = Math.max(1, 6 - Math.abs(y - 5));
    bar(p, 8 - Math.round(w / 2), 6 + y, w, 1, y > 5 ? PALETTE.energy.bright : c);
  }
};

const STAR = (p, c = PALETTE.sign.amber) => {
  bar(p, 7, 2, 3, 13, c);
  bar(p, 2, 7, 13, 3, c);
  diag(p, 4, 4, 13, 13, c, 1);
  diag(p, 13, 4, 4, 13, c, 1);
};

const WRENCH = (p, c = PALETTE.metal.light) => {
  ring(p, 5, 5, 3, c);
  px(p, 5, 5, U.navy);
  diag(p, 7, 7, 13, 13, c, 3);
  bar(p, 12, 12, 3, 3, c);
};

const BATTERY = (p, level = 0.7) => {
  bar(p, 2, 5, 12, 9, PALETTE.metal.mid);
  bar(p, 3, 6, 10, 7, U.navy);
  bar(p, 14, 8, 2, 3, PALETTE.metal.light);
  const fill = Math.round(9 * level);
  bar(p, 4, 13 - fill, fill, fill, PALETTE.ui.green);
};

const PANEL = (p) => {
  for (let y = 0; y < 6; y++) bar(p, 2 + Math.round(y / 2), 4 + y, 12 - y, 1, PALETTE.panel.mid);
  bar(p, 3, 5, 4, 2, PALETTE.panel.light);
  bar(p, 9, 9, 4, 2, PALETTE.panel.light);
};

const PIN = (p, c = PALETTE.ui.red) => {
  disc(p, 8, 6, 4, c);
  px(p, 8, 6, U.text);
  diag(p, 8, 10, 8, 15, c, 2);
};

/** Registry of every icon by name; build.js emits them all into the UI atlas. */
export const ICONS = {
  tool_select: (p) => { diag(p, 4, 2, 4, 13, U.text, 1); diag(p, 4, 2, 12, 8, U.text, 1); diag(p, 7, 8, 11, 13, U.text, 1); bar(p, 9, 10, 2, 5, U.text); },
  tool_build: (p) => { WRENCH(p); bar(p, 2, 12, 4, 3, PALETTE.metal.dark); },
  tool_city: (p) => { HOUSE(p); bar(p, 11, 7, 4, 8, PALETTE.shopWall.mid); bar(p, 12, 8, 1, 1, PALETTE.window.day); bar(p, 13, 10, 1, 1, PALETTE.window.lit); },
  tool_road: (p) => { bar(p, 2, 3, 13, 11, PALETTE.road.mid); for (let y = 4; y < 14; y += 3) bar(p, 8, y, 1, 2, PALETTE.road.mark); },
  tool_power: (p) => TOWER(p),
  tool_energy: (p) => { BOLT(p); ring(p, 8, 8, 7, U.cyan); },
  tool_weather: (p) => { SUN(p); CLOUD(p, U.textDim); },
  tool_event: (p) => STAR(p),
  tool_scenario: (p) => CHART(p),
  tool_overlay: (p) => { bar(p, 3, 9, 11, 4, U.cyan); bar(p, 5, 6, 11, 4, lighten(U.blue, 0.1)); bar(p, 3, 3, 11, 3, U.textDim); },

  stat_demand: (p) => BOLT(p, PALETTE.energy.bright),
  stat_required: (p) => BOLT(p, U.amber),
  stat_capacity: (p) => { ring(p, 8, 8, 6, U.text); diag(p, 8, 8, 11, 4, PALETTE.ui.green, 2); disc(p, 8, 8, 1, U.text); },
  stat_reserve: (p) => { bar(p, 4, 3, 9, 3, U.cyan); bar(p, 3, 6, 11, 6, PALETTE.ui.green); bar(p, 5, 12, 7, 2, darken(PALETTE.ui.green, 0.3)); },
  stat_cities: (p) => PIN(p, U.cyan),
  stat_clock: (p) => { ring(p, 8, 8, 6, U.text); diag(p, 8, 8, 8, 4, U.text, 1); diag(p, 8, 8, 11, 9, U.text, 1); },
  stat_deficit: (p) => { bar(p, 3, 3, 11, 11, darken(U.red, 0.35)); diag(p, 5, 5, 12, 12, U.text, 2); diag(p, 12, 5, 5, 12, U.text, 2); },

  weather_sun: (p) => SUN(p),
  weather_cloud: (p) => CLOUD(p),
  weather_rain: (p) => { CLOUD(p, U.textDim); DROP(p); bar(p, 5, 13, 1, 3, PALETTE.water.high); bar(p, 11, 13, 1, 3, PALETTE.water.high); },
  weather_storm: (p) => { CLOUD(p, PALETTE.metal.dark); BOLT(p, PALETTE.energy.bright); },
  weather_heat: (p) => { FLAME(p); bar(p, 2, 14, 13, 1, U.amber); },

  speed_1: (p) => { bar(p, 7, 3, 2, 11, U.text); },
  speed_2: (p) => { bar(p, 5, 3, 2, 11, U.text); bar(p, 9, 3, 2, 11, U.text); },
  speed_4: (p) => { bar(p, 3, 3, 2, 11, U.text); bar(p, 7, 3, 2, 11, U.text); bar(p, 11, 3, 2, 11, U.text); },
  speed_8: (p) => { for (let x = 2; x < 15; x += 3) bar(p, x, 3, 2, 11, U.text); },
  play: (p) => { for (let y = 0; y < 12; y++) bar(p, 5, 3 + y, 12 - y, 1, PALETTE.ui.green); },
  pause: (p) => { bar(p, 4, 3, 3, 11, U.text); bar(p, 10, 3, 3, 11, U.text); },
  step_prev: (p) => { bar(p, 3, 3, 2, 11, U.text); for (let y = 0; y < 11; y++) bar(p, 12 - y, 3 + y, y + 1, 1, U.text); },
  step_next: (p) => { for (let y = 0; y < 11; y++) bar(p, 4, 3 + y, 11 - y, 1, U.text); bar(p, 14, 3, 2, 11, U.text); },
  calendar: (p) => { bar(p, 2, 4, 13, 10, U.text); bar(p, 2, 4, 13, 3, U.red); for (let x = 4; x < 14; x += 3) for (let y = 9; y < 14; y += 3) px(p, x, y, U.navy); },
  horizon: (p) => { CHART(p, U.amber); bar(p, 11, 2, 1, 13, U.amber); },

  overlay_demand: (p) => { BOLT(p, PALETTE.energy.bright); bar(p, 2, 13, 4, 2, U.red); bar(p, 7, 13, 4, 2, U.amber); bar(p, 12, 13, 3, 2, PALETTE.ui.green); },
  overlay_population: (p) => { disc(p, 6, 5, 2, U.text); bar(p, 4, 8, 5, 7, U.text); disc(p, 12, 7, 2, U.textDim); bar(p, 10, 10, 5, 5, U.textDim); },
  overlay_supply: (p) => { TOWER(p, PALETTE.energy.bright); diag(p, 1, 8, 15, 8, U.cyan, 1); },
  overlay_stress: (p) => { bar(p, 3, 12, 3, 2, PALETTE.ui.green); bar(p, 7, 8, 3, 6, U.amber); bar(p, 11, 4, 3, 10, U.red); },
  overlay_weather: (p) => { SUN(p); CLOUD(p, U.textDim); bar(p, 3, 13, 2, 2, PALETTE.water.high); },
  overlay_forecast: (p) => { CHART(p, U.text); diag(p, 6, 12, 14, 3, U.cyan, 1); },

  event_heatwave: (p) => { FLAME(p); bar(p, 2, 14, 13, 1, U.amber); },
  event_factory: (p) => { bar(p, 2, 7, 12, 8, PALETTE.metal.mid); bar(p, 3, 5, 3, 2, PALETTE.metal.dark); bar(p, 9, 3, 2, 4, PALETTE.rust.mid); bar(p, 5, 10, 2, 5, U.navy); },
  event_festival: (p) => { STAR(p, PALETTE.sign.rose); diag(p, 8, 8, 3, 15, PALETTE.sign.cyan, 1); diag(p, 8, 8, 13, 15, PALETTE.sign.lime, 1); },
  event_maintenance: (p) => { WRENCH(p, U.amber); bar(p, 2, 13, 5, 2, U.amber); },
  event_ev: (p) => { CAR(p, PALETTE.ui.green); BOLT(p, PALETTE.energy.bright); },
  event_solar: (p) => { PANEL(p); SUN(p); },
  event_wind: (p) => { bar(p, 8, 4, 1, 11, U.text); diag(p, 8, 5, 3, 2, U.text, 1); diag(p, 8, 5, 13, 3, U.text, 1); diag(p, 8, 6, 9, 12, U.text, 1); },

  kind_residential: (p) => HOUSE(p),
  kind_commercial: (p) => { bar(p, 2, 4, 12, 11, PALETTE.shopWall.mid); bar(p, 2, 4, 12, 2, PALETTE.shopRoof.blue); bar(p, 4, 8, 3, 3, PALETTE.glass.day); bar(p, 9, 8, 3, 3, PALETTE.glass.day); },
  kind_industrial: (p) => { bar(p, 2, 8, 12, 7, PALETTE.metal.mid); for (let x = 0; x < 3; x++) { bar(p, 3 + x * 4, 5, 3, 3, PALETTE.metal.light); } bar(p, 11, 2, 2, 6, PALETTE.rust.mid); },
  kind_plant: (p) => { bar(p, 2, 8, 9, 7, PALETTE.metal.mid); bar(p, 12, 4, 2, 11, PALETTE.rust.mid); disc(p, 6, 5, 3, PALETTE.metal.light); },
  kind_battery: (p) => BATTERY(p, 0.8),
  kind_substation: (p) => { bar(p, 3, 8, 4, 6, PALETTE.metal.mid); bar(p, 9, 6, 4, 8, PALETTE.metal.mid); bar(p, 4, 6, 2, 2, PALETTE.hazard.yellow); bar(p, 10, 4, 2, 2, PALETTE.hazard.yellow); },
  kind_pylon: (p) => TOWER(p, PALETTE.cable.light),
  kind_solar: (p) => PANEL(p),
  kind_wind: (p) => { bar(p, 8, 5, 1, 10, U.text); diag(p, 8, 5, 2, 3, U.text, 1); diag(p, 8, 5, 14, 4, U.text, 1); },

  alert_warning: (p) => { for (let y = 0; y < 13; y++) bar(p, 8 - Math.round(y / 2.3), 3 + y, Math.round(y / 1.15) + 1, 1, U.amber); bar(p, 8, 7, 1, 4, U.navy); px(p, 8, 13, U.navy); },
  alert_critical: (p) => { bar(p, 3, 3, 11, 11, U.red); diag(p, 5, 5, 12, 12, U.text, 2); diag(p, 12, 5, 5, 12, U.text, 2); },
  check_ok: (p) => { diag(p, 3, 8, 7, 13, PALETTE.ui.green, 2); diag(p, 7, 13, 14, 3, PALETTE.ui.green, 2); },
};

/** Render one icon by name. */
export function icon(name, kind = 'button') {
  const draw = ICONS[name];
  if (!draw) throw new Error(`unknown icon: ${name}`);
  const p = plate(kind);
  draw(p);
  // A single dark outline around the plate keeps icons legible on bright tiles.
  p.rect(1, 1, SIZE - 2, 1, OUTLINE);
  p.rect(1, SIZE - 2, SIZE - 2, 1, OUTLINE);
  p.rect(1, 1, 1, SIZE - 2, OUTLINE);
  p.rect(SIZE - 2, 1, 1, SIZE - 2, OUTLINE);
  return p;
}
