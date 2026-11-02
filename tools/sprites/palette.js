/**
 * Single source of truth for every colour in the game.
 *
 * The palette is deliberately narrow (GBA-era size) and each family keeps a
 * light/mid/dark triplet so shading is consistent wherever it is applied. Light
 * comes from the north-west face: top surfaces are lightest, left faces mid,
 * right faces darkest.
 */

export const OUTLINE = '#202430';

export const PALETTE = {
  grass:       { light: '#86c95c', mid: '#6cb04a', dark: '#568f3a', shadow: '#3f6b2c' },
  dirt:        { light: '#c39a63', mid: '#a8804f', dark: '#8a6640' },
  sand:        { light: '#e8d29a', mid: '#d9c07a', dark: '#bda45f' },
  water:       { high: '#6fc3e8', mid: '#3f8fd0', dark: '#2f6fb5', deep: '#1f4d80' },
  road:        { light: '#5d6474', mid: '#4a4f5e', dark: '#383c47', mark: '#d8dbe0' },
  forest:      { light: '#47a055', mid: '#2f7a3c', dark: '#1f5c2c', trunk: '#6b4a2a' },
  rock:        { light: '#a9adba', mid: '#8b8f9c', dark: '#6f7382', snow: '#e6e9f0' },

  houseWall:   { light: '#f5dcb0', mid: '#e8b98a', dark: '#d19a6b' },
  houseRoof:   { red: '#c0504a', brick: '#a8403f', timber: '#7a5c3e', slate: '#4d7a8c', teal: '#3f8f8a' },
  wood:        { light: '#a97b46', mid: '#8b5a2b', dark: '#6b4520' },

  shopWall:    { light: '#f5efe0', mid: '#e9e2c8', dark: '#cfc7ab' },
  shopRoof:    { blue: '#3f7fb5', navy: '#2f5f8f', plum: '#6b4a7a', green: '#4a8f5c' },
  glass:       { lit: '#c9eaf5', day: '#a8d8ea', dark: '#5f8fa8' },
  sign:        { amber: '#e0a33a', rose: '#e0687a', cyan: '#4fd6e0', lime: '#9ad15a' },

  metal:       { light: '#b5bcc7', mid: '#9aa3ae', dark: '#7b848f', deeper: '#5d6570' },
  rust:        { light: '#d08a45', mid: '#b5651d', dark: '#8a4b16' },
  hazard:      { orange: '#e08a2e', yellow: '#f5c542', stripe: '#2b2f3a' },

  energy:      { spark: '#fff2a8', bright: '#ffd23f', mid: '#f5a623', glow: '#ffe9a8' },
  cable:       { light: '#6f7c8a', mid: '#545f6d', dark: '#3b434e' },
  panel:       { light: '#3a5f8a', mid: '#2c4a70', dark: '#1f3555' },

  window:      { day: '#6f95b5', dark: '#40637f', lit: '#ffd97a', litBright: '#ffe9a8', off: '#2c3a4a' },
  night:       { tint: '#2a3350', shadow: '#1b2138' },

  ui: {
    navy: '#131a2b', navyMid: '#1c2740', navyLight: '#28375a',
    cyan: '#4fd6e0', blue: '#3f8fd0', amber: '#f5a623',
    red: '#e0524a', green: '#4ecb71', text: '#dfe6f0', textDim: '#8fa0bd',
  },

  vehicle: { car1: '#d8503f', car2: '#3f7fd8', car3: '#e8d29a', truck: '#4a8f5c',
             van: '#cfc7ab', dark: '#2b3040', tyre: '#1e222c' },
};

/** '#rrggbb' -> [r, g, b] */
export function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Multiply a colour toward black (amount 0..1) while biasing to cool tones. */
export function darken(hex, amount) {
  const [r, g, b] = rgb(hex);
  const k = 1 - amount;
  const to = (v, cool) => Math.max(0, Math.round(v * k + (cool ? 10 * amount : 0)));
  return hexFrom(to(r, false), to(g, false), to(b, true));
}

/** Mix a colour toward white. */
export function lighten(hex, amount) {
  const [r, g, b] = rgb(hex);
  const to = (v) => Math.min(255, Math.round(v + (255 - v) * amount));
  return hexFrom(to(r), to(g), to(b));
}

export function hexFrom(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Cool the colour down for night-time facades without destroying hue order. */
export function nightify(hex, strength = 0.55) {
  const [r, g, b] = rgb(hex);
  const [nr, ng, nb] = rgb(PALETTE.night.tint);
  return hexFrom(
    Math.round(r * (1 - strength) + nr * strength),
    Math.round(g * (1 - strength) + ng * strength),
    Math.round(b * (1 - strength) + nb * strength),
  );
}
