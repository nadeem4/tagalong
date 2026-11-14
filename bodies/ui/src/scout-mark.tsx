/**
 * Scout's still mark: its head as a small SVG (gold shell, dark screen, sky eyes), the same
 * colours the live mascot wears. It is drawn beside lines Scout starts, in Home's nav tile and
 * in the tour, where a live WebGL canvas per line would be too heavy. Decorative; the word
 * "Scout" next to it is the real text. Contains ScoutGlyph and ScoutMark.
 */

import { themeTokens as t } from './theme/tokens';

/** A rounded box in the glyph's 32-unit square. */
export interface GlyphBox {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** The head without its eyes, back to front. The gather overlay draws the same shapes. */
export const GLYPH_BOXES: readonly (GlyphBox & { fill: string })[] = [
  { x: 15.4, y: 3.5, w: 1.2, h: 3.5, r: 0, fill: t.color.textMuted },
  { x: 14.3, y: 1.3, w: 3.4, h: 3.4, r: 1.7, fill: t.color.sky },
  { x: 0.8, y: 13, w: 3.2, h: 7.5, r: 1.6, fill: t.color.keycapLine },
  { x: 28, y: 13, w: 3.2, h: 7.5, r: 1.6, fill: t.color.keycapLine },
  { x: 3, y: 7, w: 26, h: 19, r: 7, fill: t.color.gold },
  { x: 6, y: 10, w: 20, h: 13, r: 4.5, fill: t.color.goldInk },
];

/** The two eyes, in sky. */
export const GLYPH_EYES: readonly GlyphBox[] = [
  { x: 10.5, y: 14, w: 3.6, h: 5.2, r: 1.8 },
  { x: 17.9, y: 14, w: 3.6, h: 5.2, r: 1.8 },
];

/** Scout's head, drawn to fill a square of `size` px. */
export function ScoutGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {GLYPH_BOXES.map((b) => (
        <rect
          key={`${b.x}-${b.y}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={b.r}
          fill={b.fill}
        />
      ))}
      {GLYPH_EYES.map((e) => (
        <rect key={e.x} x={e.x} y={e.y} width={e.w} height={e.h} rx={e.r} fill={t.color.sky} />
      ))}
    </svg>
  );
}

interface ScoutMarkProps {
  /** The tile's side in px. */
  size?: number;
}

export function ScoutMark({ size = 20 }: ScoutMarkProps) {
  return (
    <span className="scout-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <ScoutGlyph size={Math.round(size * 0.82)} />
    </span>
  );
}
