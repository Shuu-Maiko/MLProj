/**
 * Shelf packer + PNG writer for the generated sprite atlases.
 *
 * Sprites are packed at full canvas size — no trimming. Trimming looks cheaper, but it
 * forces the game to reconstruct where the logical origin went, and an off-by-one there
 * shows up as buildings floating a few pixels off their tile. The anchor recorded per
 * frame is the pixel that must land on the sprite's grid position.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const PAD = 2;

export class Atlas {
  constructor(name) {
    this.name = name;
    this.frames = new Map();
  }

  /** `anchor` is the device pixel inside the sprite that sits on the tile position. */
  add(key, painter, anchor = null) {
    if (this.frames.has(key)) throw new Error(`duplicate frame ${key} in ${this.name}`);
    this.frames.set(key, { painter, anchor: anchor ?? { x: Math.round(painter.w / 2), y: painter.h - 1 } });
    return this;
  }

  get size() {
    return this.frames.size;
  }

  pack() {
    const items = [...this.frames.entries()].map(([key, { painter, anchor }]) => ({
      key, painter, anchor, w: painter.w, h: painter.h,
    }));
    items.sort((a, b) => b.h - a.h || b.w - a.w);

    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => r.x + PAD + it.w + PAD <= 4096 && r.h >= it.h);
      if (row) {
        row.x += PAD;
        it.px = row.x;
        it.py = row.y + (row.h - it.h);
        row.x += it.w + PAD;
      } else {
        const y = rows.length ? rows[rows.length - 1].bottom : 0;
        it.px = PAD;
        it.py = y;
        rows.push({ y, h: it.h, x: PAD + it.w, bottom: y + it.h + PAD });
      }
    }
    const width = Math.max(...rows.map((r) => r.x + PAD), 32);
    const height = Math.max(...rows.map((r) => r.bottom), 32);
    return { items, width, height };
  }

  write(outDir) {
    const { items, width, height } = this.pack();
    const png = new PNG({ width, height });
    png.data.fill(0);
    const meta = { group: this.name, size: { width, height }, frames: {} };

    for (const it of items) {
      const src = it.painter;
      for (let y = 0; y < it.h; y++) {
        for (let x = 0; x < it.w; x++) {
          const si = ((y * src.w) + x) * 4;
          const di = ((it.py + y) * width + (it.px + x)) * 4;
          png.data[di] = src.data[si];
          png.data[di + 1] = src.data[si + 1];
          png.data[di + 2] = src.data[si + 2];
          png.data[di + 3] = src.data[si + 3];
        }
      }
      meta.frames[it.key] = {
        frame: { x: it.px, y: it.py, w: it.w, h: it.h },
        // Not "anchor": Phaser reads that key as a normalised pivot and calls
        // setOrigin() with it, which would misplace every sprite by its pixel values.
        groundAnchor: it.anchor,
        rotated: false,
        sourceSize: { w: it.w, h: it.h },
        spriteSourceSize: { x: 0, y: 0, w: it.w, h: it.h },
      };
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${this.name}.png`), PNG.sync.write(png));
    fs.writeFileSync(path.join(outDir, `${this.name}.json`), JSON.stringify(meta, null, 2));
    return { width, height, count: items.length };
  }
}
