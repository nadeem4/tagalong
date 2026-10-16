/**
 * A 3x5 bitmap font for the composite's display numbers and the word BLOCKED. Contains labelSize
 * and drawLabel.
 */

import { createCanvas, blit } from './canvas';
import type { Bitmap, Colour } from './canvas';

/**
 * A 3x5 bitmap font, digits only.
 *
 * The composite needs each display's number written in its corner so the pet can name the
 * one it wants when it calls `look_at_display`. That is all the text the composite needs,
 * and it does not justify a font stack or an offscreen browser window: ten glyphs of
 * fifteen bits each cover it.
 *
 * Rows run top to bottom, each string one row, `#` for an inked pixel.
 */
const GLYPH_WIDTH = 3;
const GLYPH_HEIGHT = 5;
const GLYPH_GAP = 1;
/** Breathing room between the glyphs and the edge of the backing box. */
const PADDING = 1;

const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  // Just the letters of BLOCKED, the only word the composite draws. Uppercase
  // because lowercase descenders do not survive a five-pixel cell. Extend deliberately
  // rather than reaching for a font: every glyph added here is a glyph to keep legible.
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  L: ['#..', '#..', '#..', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  C: ['###', '#..', '#..', '#..', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '###', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
};

export interface LabelSize {
  width: number;
  height: number;
}

/** How much room `drawLabel` will take, backing box included. */
export function labelSize(text: string, scale: number): LabelSize {
  const glyphs = text.length;
  const inked = glyphs * GLYPH_WIDTH + Math.max(0, glyphs - 1) * GLYPH_GAP;
  return {
    width: (inked + PADDING * 2) * scale,
    height: (GLYPH_HEIGHT + PADDING * 2) * scale,
  };
}

/**
 * Writes `text` at (x, y) on a filled backing box, clipped to the canvas.
 *
 * The box is not decoration: the label is drawn over a screenshot, and a light glyph on a
 * light document is invisible exactly when the user most needs to tell two monitors apart.
 *
 * Characters with no glyph are skipped rather than rejected. The caller passes display
 * ordinals, so this cannot happen today — but a label that silently loses a character is
 * a better failure than a composite that throws.
 */
export function drawLabel(
  target: Bitmap,
  text: string,
  x: number,
  y: number,
  scale: number,
  foreground: Colour,
  background: Colour,
): void {
  const size = labelSize(text, scale);
  blit(target, createCanvas(size.width, size.height, background), x, y);

  const block = createCanvas(scale, scale, foreground);
  let penX = x + PADDING * scale;
  const penY = y + PADDING * scale;

  for (const character of text) {
    const glyph = GLYPHS[character];
    if (glyph !== undefined) {
      glyph.forEach((row, rowIndex) => {
        for (let column = 0; column < row.length; column += 1) {
          if (row[column] !== '#') continue;
          // blit clips, so a glyph running off the canvas loses pixels rather than
          // writing past the end of the buffer.
          blit(target, block, penX + column * scale, penY + rowIndex * scale);
        }
      });
    }
    penX += (GLYPH_WIDTH + GLYPH_GAP) * scale;
  }
}
