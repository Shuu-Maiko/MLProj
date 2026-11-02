/**
 * The Phaser world: renders the map produced by lib/world.ts and animates it from the
 * simulation's numbers. It owns no game state — React does — so the scene is a view
 * that receives setX updates. That keeps the pixel art, the simulation and the HUD
 * independently testable and stops the render loop from being a second source of truth.
 */

import Phaser from 'phaser';

import { HW, ZOOM_STEPS, depthOf, gridToScreen, tileAt } from '@/lib/iso';
import { terrainFrame, type WorldMap } from '@/lib/world';
import type { CityLoad } from '@/lib/sim';
import type { City, Selection } from '@/lib/types';

export type SceneBridge = {
  onSelect: (sel: Selection) => void;
  onZoom: (zoom: number) => void;
};

export type SpriteAnchors = {
  smoke: [number, number][];
  steam: [number, number][];
  outlet: [number, number];
};

export type SceneData = {
  world: WorldMap;
  cities: City[];
  bridge: SceneBridge;
  /** Ground-relative anchor points emitted by the atlas builder. */
  anchors: { plant: SpriteAnchors };
};

type Pulse = { sprite: Phaser.GameObjects.Image; path: { x: number; y: number }[]; offset: number };
type Vehicle = { sprite: Phaser.GameObjects.Image; route: { x: number; y: number }[]; phase: number; laps: number };
type Plume = { sprite: Phaser.GameObjects.Image; baseY: number; cycle: number; kind: 'smoke' | 'steam' };

const DAY_START = 6;
const NIGHT_START = 19;
/** Height of a pylon's cable arm above its tile, in world pixels. */
const PYLON_ARM = 62;
/**
 * HUD bands covering the canvas, in CSS px. Centring has to aim at the middle of what is
 * actually visible, or every focused district ends up tucked under a panel.
 */
const HUD_INSET = { top: 96, bottom: 92, left: 16, right: 452 };

export function hourOf(hour: number) {
  return ((hour % 24) + 24) % 24;
}

function isNightHour(hour: number) {
  const h = hourOf(hour);
  return h < DAY_START || h >= NIGHT_START;
}

/** Twilight ramp 0 (day) -> 1 (night) so lighting eases instead of snapping. */
function nightFactor(hour: number) {
  const h = hourOf(hour);
  if (h >= 8 && h < 17) return 0;
  if (h >= 17 && h < NIGHT_START) return (h - 17) / (NIGHT_START - 17);
  if (h >= NIGHT_START || h < 5) return 1;
  return 1 - (h - 5) / (DAY_START - 5);
}

export class CityScene extends Phaser.Scene {
  private world!: WorldMap;
  private cities: City[] = [];
  private bridge!: SceneBridge;

  private groundLayer!: Phaser.GameObjects.Layer;
  private objectLayer!: Phaser.GameObjects.Layer;
  private fxLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;

  private waterTiles: Phaser.GameObjects.Image[] = [];
  private buildingImages = new Map<string, { img: Phaser.GameObjects.Image; frame: string; x: number; y: number }>();
  private plantImage?: Phaser.GameObjects.Image;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private pulses: Pulse[] = [];
  private vehicles: Vehicle[] = [];
  private plumes: Plume[] = [];
  private lamps: Phaser.GameObjects.Image[] = [];
  private selectionRing?: Phaser.GameObjects.Image;

  private hour = 0;
  private night = false;
  private zoomIndex = 1;
  private loads = new Map<string, CityLoad>();

  private dragging = false;
  private dragMoved = false;
  private dragStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

  constructor() {
    super('city');
  }

  private plantAnchors!: SpriteAnchors;

  init(data: SceneData) {
    this.cities = data.cities;
    this.world = data.world;
    this.bridge = data.bridge;
    this.plantAnchors = data.anchors.plant;
  }

  preload() {
    this.load.atlas('terrain', 'assets/terrain.png', 'assets/terrain.json');
    this.load.atlas('buildings', 'assets/buildings.png', 'assets/buildings.json');
    this.load.atlas('buildings_night', 'assets/buildings_night.png', 'assets/buildings_night.json');
    this.load.atlas('energy', 'assets/energy.png', 'assets/energy.json');
    this.load.atlas('vehicles', 'assets/vehicles.png', 'assets/vehicles.json');
    this.load.atlas('fx', 'assets/fx.png', 'assets/fx.json');
  }

  create() {
    // Layer depth is per-Layer, not per-child: without these the ground plane, which is
    // built after the objects list exists, would paint over every building.
    this.groundLayer = this.add.layer().setDepth(-100);
    this.objectLayer = this.add.layer().setDepth(0);
    this.fxLayer = this.add.layer().setDepth(10);
    this.uiLayer = this.add.layer().setDepth(20);

    this.drawGround();
    this.drawBuildings();
    this.drawPlant();
    this.drawTransmission();
    this.drawCityChrome();
    this.spawnVehicles();
    this.spawnStreetLamps();
    this.buildRings();

    const span = this.world.size * HW;
    const cam = this.cameras.main;
    cam.setBounds(-span, -span, span * 3, span * 3);
    cam.setBackgroundColor('#0b1120');
    cam.setZoom(ZOOM_STEPS[this.zoomIndex]);
    // Open on the first district so a label and its prediction are both on screen.
    const at = this.anchorFor({ kind: 'city', id: this.cities[0]?.id ?? '' })
      ?? { x: 0, y: span * 0.5 };
    const home = this.centerScroll(at);
    cam.scrollX = home.x;
    cam.scrollY = home.y;

    this.wireInput();
    this.startAnimation();
    this.updateLabels();
  }

  // --- placement helpers ----------------------------------------------------

  /**
   * Position a sprite so the ground anchor recorded by the atlas builder lands on the
   * tile point. Without this buildings would float a few pixels off their plot.
   */
  private place(img: Phaser.GameObjects.Image, atlas: string, frame: string, at: { x: number; y: number }) {
    const f = this.textures.get(atlas).get(frame);
    const anchor = (f.customData as { groundAnchor?: { x: number; y: number } }).groundAnchor
      ?? { x: Math.round(f.width / 2), y: f.height };
    img.setOrigin(anchor.x / f.width, anchor.y / f.height);
    img.setPosition(at.x, at.y);
    return img;
  }

  // --- construction ---------------------------------------------------------

  private drawGround() {
    const layer = this.groundLayer;
    for (const t of this.world.tiles) {
      const frame = terrainFrame(t);
      const img = this.add.image(0, 0, 'terrain', frame);
      this.place(img, 'terrain', frame, gridToScreen(t.x, t.y));
      img.setDepth(depthOf(t.x, t.y, -8));
      layer.add(img);
      if (t.kind === 'water') this.waterTiles.push(img);
    }
  }

  private drawBuildings() {
    for (const p of this.world.placed) {
      const atlas = this.night ? 'buildings_night' : 'buildings';
      const img = this.add.image(0, 0, atlas, p.frame);
      this.place(img, atlas, p.frame, gridToScreen(p.x, p.y));
      img.setDepth(depthOf(p.x + p.w, p.y + p.d, 0));
      img.setData({ kind: 'building', id: p.id, cityId: p.cityId ?? '' });
      img.setInteractive();
      this.objectLayer.add(img);
      this.buildingImages.set(p.id, { img, frame: p.frame, x: p.x, y: p.y });
    }
  }

  private drawPlant() {
    const { x, y } = this.world.plantGrid;
    const at = gridToScreen(x, y);
    const frame = this.night ? 'plant_night' : 'plant_day';
    const img = this.add.image(0, 0, 'energy', frame);
    this.place(img, 'energy', frame, at);
    img.setDepth(depthOf(x + 4, y + 3, 2));
    img.setData({ kind: 'plant', id: 'plant' });
    img.setInteractive();
    this.objectLayer.add(img);
    this.plantImage = img;

    // Plume origins come from the atlas builder's emitted anchors, so they stay correct
    // when the plant art changes.
    const anchors = this.plantAnchors;
    for (const [i, a] of anchors.smoke.entries()) {
      for (let f = 0; f < 4; f++) {
        const sprite = this.add.image(at.x + a[0], at.y + a[1], 'fx', 'smoke_0');
        sprite.setDepth(depthOf(x + 4, y + 3, 3 + i)).setVisible(false);
        this.fxLayer.add(sprite);
        this.plumes.push({ sprite, baseY: at.y + a[1], cycle: i, kind: 'smoke' });
      }
    }
    for (const [i, a] of anchors.steam.entries()) {
      for (let f = 0; f < 4; f++) {
        const sprite = this.add.image(at.x + a[0], at.y + a[1], 'fx', 'steam_0');
        sprite.setDepth(depthOf(x + 4, y + 3, 3 + i)).setVisible(false);
        this.fxLayer.add(sprite);
        this.plumes.push({ sprite, baseY: at.y + a[1], cycle: i, kind: 'steam' });
      }
    }
  }

  private drawTransmission() {
    const cables = this.add.graphics();
    cables.lineStyle(1, 0x545f6d, 1);
    for (const line of this.world.lines) {
      const pts = this.cablePath(line.from, line.to);
      cables.beginPath();
      cables.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) cables.lineTo(p.x, p.y);
      cables.strokePath();
      for (let i = 0; i < 3; i++) {
        const sprite = this.add.image(pts[0].x, pts[0].y, 'fx', 'pulse_mid_0');
        sprite.setDepth(depthOf(line.to[0], line.to[1], 7));
        this.fxLayer.add(sprite);
        this.pulses.push({ sprite, path: pts, offset: i / 3 });
      }
    }
    this.objectLayer.add(cables);

    for (const p of this.world.pylons) {
      const img = this.add.image(0, 0, 'energy', 'pylon');
      this.place(img, 'energy', 'pylon', gridToScreen(p.x, p.y));
      img.setDepth(depthOf(p.x, p.y, 1));
      this.objectLayer.add(img);
    }
  }

  private cablePath(from: [number, number], to: [number, number]) {
    const a = gridToScreen(from[0], from[1]);
    const b = gridToScreen(to[0], to[1]);
    const pts: { x: number; y: number }[] = [];
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({
        x: a.x + (b.x - a.x) * t,
        y: (a.y - PYLON_ARM) + ((b.y - PYLON_ARM) - (a.y - PYLON_ARM)) * t + Math.sin(Math.PI * t) * 9,
      });
    }
    return pts;
  }

  /** One label per district: the city and the MW the model predicted for it. */
  private drawCityChrome() {
    for (const city of this.cities) {
      const b = this.world.districtBounds[city.id];
      if (!b) continue;
      const at = gridToScreen(b.x + b.w / 2, b.y);
      const label = this.add.text(at.x, at.y - 40, city.name, {
        fontFamily: 'sans-serif', fontSize: '17px', fontStyle: '600', color: '#e8eefb',
        backgroundColor: '#182136e6', padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 1);
      this.uiLayer.add(label);
      this.labels.set(city.id, label);
    }
  }

  private spawnVehicles() {
    const roads = this.world.tiles.filter((t) => t.kind === 'road');
    if (!roads.length) return;
    const kinds = ['car', 'car', 'van', 'truck', 'bus', 'service'];
    for (let i = 0; i < 16; i++) {
      const kind = kinds[i % kinds.length];
      const start = roads[(i * 173) % roads.length];
      const route = this.roadRoute(start, 7 + (i % 6));
      if (route.length < 2) continue;
      const heading = i % 2;
      const sprite = this.add.image(route[0].x, route[0].y, 'vehicles', vehicleFrame(kind, heading, this.night));
      sprite.setDepth(depthOf(start.x, start.y, 6));
      this.fxLayer.add(sprite);
      this.vehicles.push({ sprite, route, phase: i / 16, laps: 1 + (i % 3) });
      sprite.setData({ kind: 'vehicle', heading, base: kind });
    }
  }

  /** Walk connected road tiles so a vehicle has something plausible to drive along. */
  private roadRoute(from: { x: number; y: number }, length: number) {
    const roadSet = new Set(this.world.tiles.filter((t) => t.kind === 'road').map((t) => `${t.x},${t.y}`));
    const pts: { x: number; y: number }[] = [];
    let cur: [number, number] = [from.x, from.y];
    let dir: [number, number] = roadSet.has(`${cur[0] + 1},${cur[1]}`) ? [1, 0] : [0, 1];
    for (let i = 0; i < length; i++) {
      let next: [number, number] = [cur[0] + dir[0], cur[1] + dir[1]];
      if (!roadSet.has(`${next[0]},${next[1]}`)) {
        dir = dir[0] === 1 ? [0, 1] : [1, 0];
        next = [cur[0] + dir[0], cur[1] + dir[1]];
        if (!roadSet.has(`${next[0]},${next[1]}`)) break;
      }
      cur = next;
      pts.push(gridToScreen(cur[0], cur[1]));
    }
    return pts;
  }

  private spawnStreetLamps() {
    const spots = this.world.tiles.filter((t) => t.kind === 'road' && (t.x * 3 + t.y) % 7 === 0);
    for (const t of spots.slice(0, 120)) {
      const at = gridToScreen(t.x, t.y);
      const lamp = this.add.image(at.x, at.y - 4, 'fx', 'spark_0');
      lamp.setDepth(depthOf(t.x, t.y, 6)).setAlpha(0);
      this.fxLayer.add(lamp);
      this.lamps.push(lamp);
    }
  }

  private buildRings() {
    this.selectionRing = this.add.image(0, 0, 'fx', 'ring_select').setVisible(false);
    this.uiLayer.add(this.selectionRing);
  }

  // --- animation ------------------------------------------------------------

  private startAnimation() {
    let waterFrame = 0;
    this.time.addEvent({
      delay: 300, loop: true,
      callback: () => {
        waterFrame = (waterFrame + 1) % 4;
        for (const img of this.waterTiles) img.setFrame(`water_${waterFrame}`);
      },
    });

    let plumeStep = 0;
    this.time.addEvent({
      delay: 240, loop: true,
      callback: () => {
        plumeStep = (plumeStep + 1) % 4;
        const duty = Math.min(1, this.flowLevel());
        for (let i = 0; i < this.plumes.length; i += 4) {
          const group = this.plumes.slice(i, i + 4);
          const rising = plumeStep;
          group.forEach((p, j) => {
            const active = j === rising;
            p.sprite.setVisible(active);
            if (active) {
              p.sprite.setFrame(`${p.kind}_${j}`);
              p.sprite.setAlpha(0.34 + duty * 0.45);
              p.sprite.setPosition(p.sprite.x, p.baseY - j * 7);
            }
          });
          // Reset the column so the next puff starts at the mouth.
          if (rising === 0) group.forEach((p) => p.sprite.setPosition(p.sprite.x, p.baseY));
        }
      },
    });

    this.tweens.addCounter({
      from: 0, to: 1, duration: 5200, repeat: -1,
      onUpdate: (t) => this.stepPulses(t.getValue() ?? 0),
    });
    this.tweens.addCounter({
      from: 0, to: 1, duration: 11000, repeat: -1,
      onUpdate: (t) => this.stepVehicles(t.getValue() ?? 0),
    });
  }

  /** Pulse band and cadence follow live flow, which is the whole point of the effect. */
  private stepPulses(cycle: number) {
    const level = this.flowLevel();
    const band = level > 1.02 ? 'crit' : level > 0.85 ? 'high' : level > 0.55 ? 'mid' : 'low';
    const cadence = 0.4 + level * 1.1;
    const frame = Math.floor(this.time.now / 120) % 4;
    for (const p of this.pulses) {
      const t = (cycle * cadence + p.offset) % 1;
      const idx = Math.min(p.path.length - 1, Math.floor(t * (p.path.length - 1)));
      p.sprite.setPosition(p.path[idx].x, p.path[idx].y);
      p.sprite.setFrame(`pulse_${band}_${frame}`);
      p.sprite.setAlpha(level > 0.01 ? 0.95 : 0.12);
    }
  }

  private stepVehicles(cycle: number) {
    for (const v of this.vehicles) {
      const u = ((cycle * v.laps + v.phase) % 1) * (v.route.length - 1);
      const i = Math.floor(u);
      const f = u - i;
      const a = v.route[i];
      const b = v.route[Math.min(v.route.length - 1, i + 1)];
      v.sprite.setPosition(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    }
  }

  /** Live load against the firm capacity the districts were designed for. */
  private flowLevel() {
    let load = 0, firm = 0;
    for (const c of this.cities) {
      load += this.loads.get(c.id)?.netMW ?? 0;
      firm += c.capacityFirmMW;
    }
    return firm > 0 ? Math.min(1.4, load / firm) : 0.35;
  }

  // --- state API used by React ---------------------------------------------

  setClock(hour: number) {
    this.hour = hour;
    const night = isNightHour(hour);
    if (night !== this.night) {
      this.night = night;
      this.swapNightAtlases();
    }
    const k = nightFactor(hour);
    for (const lamp of this.lamps) lamp.setAlpha(k > 0.3 ? 0.9 * k : 0);
    for (const v of this.vehicles) {
      const base = v.sprite.getData('base') as string;
      const heading = v.sprite.getData('heading') as number;
      v.sprite.setTexture('vehicles', vehicleFrame(base, heading, night));
    }
  }

  private swapNightAtlases() {
    const atlas = this.night ? 'buildings_night' : 'buildings';
    for (const { img, frame, x, y } of this.buildingImages.values()) {
      this.place(img.setTexture(atlas, frame), atlas, frame, gridToScreen(x, y));
    }
    if (this.plantImage) {
      const frame = this.night ? 'plant_night' : 'plant_day';
      this.place(this.plantImage.setTexture('energy', frame), 'energy', frame,
        gridToScreen(this.world.plantGrid.x, this.world.plantGrid.y));
    }
  }

  setCities(cities: City[]) {
    this.cities = cities;
  }

  setLoads(loads: Map<string, CityLoad>) {
    this.loads = loads;
    this.updateLabels();
  }

  private updateLabels() {
    for (const city of this.cities) {
      this.labels.get(city.id)?.setText(this.labelFor(city));
    }
  }

  private labelFor(city: City) {
    const load = this.loads.get(city.id);
    if (!load) return city.name;
    const mw = Math.round(load.netMW).toLocaleString('en-IN');
    return `${city.name}  ${mw} MW`;
  }

  setSelection(sel: Selection) {
    const at = this.anchorFor(sel);
    if (!at || !this.selectionRing) { this.selectionRing?.setVisible(false); return; }
    this.selectionRing.setPosition(at.x, at.y).setVisible(true);
    this.tweens.add({
      targets: this.selectionRing, alpha: { from: 1, to: 0.4 },
      duration: 650, yoyo: true, repeat: -1,
    });
  }

  private anchorFor(sel: Selection) {
    if (!sel) return null;
    if (sel.kind === 'city') {
      const b = this.world.districtBounds[sel.id];
      return b ? gridToScreen(b.x + b.w / 2, b.y + b.d / 2) : null;
    }
    return gridToScreen(sel.x, sel.y);
  }

  /** Camera scroll that puts a world point in the middle of the un-covered viewport. */
  private centerScroll(at: { x: number; y: number }) {
    const z = this.cameras.main.zoom;
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = (HUD_INSET.left + Math.max(HUD_INSET.left, w - HUD_INSET.right)) / 2;
    const cy = (HUD_INSET.top + Math.max(HUD_INSET.top, h - HUD_INSET.bottom)) / 2;
    return { x: at.x - cx / z, y: at.y - cy / z };
  }

  focusOn(sel: Selection) {
    const at = this.anchorFor(sel);
    if (!at) return;
    const cam = this.cameras.main;
    const to = this.centerScroll(at);
    this.tweens.add({
      targets: cam,
      scrollX: to.x,
      scrollY: to.y,
      duration: 420, ease: 'Cubic',
    });
  }

  // --- input ----------------------------------------------------------------

  private wireInput() {
    this.input.on('wheel', (p: Phaser.Input.Pointer, _go: unknown, _dx: number, dy: number) => {
      const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.zoomIndex + (dy < 0 ? 1 : -1)));
      if (next === this.zoomIndex) return;
      const cam = this.cameras.main;
      const before = cam.getWorldPoint(p.x, p.y);
      this.zoomIndex = next;
      cam.setZoom(ZOOM_STEPS[next]);
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
      this.bridge.onZoom(ZOOM_STEPS[next]);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.dragMoved = false;
      this.dragStart = { x: p.x, y: p.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging && p.isDown) {
        const dx = p.x - this.dragStart.x;
        const dy = p.y - this.dragStart.y;
        if (Math.hypot(dx, dy) > 4) this.dragMoved = true;
        const z = this.cameras.main.zoom;
        this.cameras.main.setScroll(this.dragStart.scrollX - dx / z, this.dragStart.scrollY - dy / z);
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false;
      if (this.dragMoved) return;
      this.bridge.onSelect(this.pick(p));
    });
  }

  private pick(p: Phaser.Input.Pointer): Selection {
    const touched = this.input.hitTestPointer(p)[0];
    if (touched?.data) {
      // Structures belong to a district; there is nothing to say about one on its own.
      const cityId = touched.data.get('cityId') as string | undefined;
      if (cityId) return { kind: 'city', id: cityId };
    }
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const g = tileAt(world.x, world.y);
    for (const [id, b] of Object.entries(this.world.districtBounds)) {
      if (g.x >= b.x && g.x < b.x + b.w && g.y >= b.y && g.y < b.y + b.d) return { kind: 'city', id };
    }
    if (g.x < 0 || g.y < 0 || g.x >= this.world.size || g.y >= this.world.size) return null;
    return { kind: 'tile', x: g.x, y: g.y };
  }
}

function vehicleFrame(kind: string, heading: number, night: boolean) {
  return `${kind}${night ? '_night' : ''}_x${heading}`;
}
