/**
 * Renders one frame of the `ui` atlas as a DOM icon.
 *
 * The HUD is React, but the art is still the atlas the sprite builder emitted, so panel
 * glyphs share the world's palette, outline weight and pixel grid instead of drifting
 * into a generic icon font.
 *
 * `size` sets the rendered *height* and the width follows the frame's own aspect ratio,
 * so a row of icons stays on one baseline. Scaling by CSS `transform` instead would leave
 * the layout box at its original size and push the label out of line.
 */

import uiAtlas from '../../public/assets/ui.json';

export type UiIcon = keyof typeof uiAtlas.frames;

export function SpriteIcon({ frame, size = 20, className = '' }: {
  frame: UiIcon;
  size?: number;
  className?: string;
}) {
  const entry = uiAtlas.frames[frame];
  if (!entry) return null;
  const { x, y, w, h } = entry.frame;
  const scale = size / h;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{
        width: Math.round(w * scale),
        height: size,
        backgroundImage: 'url(/assets/ui.png)',
        backgroundPosition: `${-x * scale}px ${-y * scale}px`,
        backgroundSize: `${uiAtlas.size.width * scale}px ${uiAtlas.size.height * scale}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}
