/** Tests for the bitmap font. */

import { describe, expect, it } from 'vitest';

import { createCanvas, pixelAt } from './canvas';
import type { Bitmap, Colour } from './canvas';
import { drawLabel, labelSize } from './label';

const BLACK: Colour = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: Colour = { r: 255, g: 255, b: 255, a: 255 };

function litPixels(bitmap: Bitmap): number {
  let lit = 0;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (pixelAt(bitmap, x, y).r === 255) lit += 1;
    }
  }
  return lit;
}

/** The lit pixels as a string, so two glyphs can be compared as shapes. */
function signature(bitmap: Bitmap): string {
  const rows: string[] = [];
  for (let y = 0; y < bitmap.height; y += 1) {
    let row = '';
    for (let x = 0; x < bitmap.width; x += 1) {
      row += pixelAt(bitmap, x, y).r === 255 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

describe('labelSize', () => {
  it('grows with the number of characters and the scale', () => {
    const one = labelSize('1', 1);
    const two = labelSize('12', 1);
    expect(two.width).toBeGreaterThan(one.width);
    expect(two.height).toBe(one.height);

    expect(labelSize('1', 2).width).toBeGreaterThan(one.width);
    expect(labelSize('1', 2).height).toBeGreaterThan(one.height);
  });
});

describe('drawLabel', () => {
  it('draws the digit in the foreground colour', () => {
    const canvas = createCanvas(20, 20, BLACK);
    drawLabel(canvas, '1', 2, 2, 1, WHITE, BLACK);

    expect(litPixels(canvas)).toBeGreaterThan(0);
  });

  it('draws different digits as different shapes', () => {
    // Without this, a font table with a copy-paste error renders every display as the
    // same glyph and the composite labels become worse than useless: confidently wrong.
    const seen = new Set<string>();
    for (const digit of '0123456789') {
      const canvas = createCanvas(8, 8, BLACK);
      drawLabel(canvas, digit, 0, 0, 1, WHITE, BLACK);
      seen.add(signature(canvas));
    }

    expect(seen.size).toBe(10);
  });

  it('draws every letter of BLOCKED as a distinct shape', () => {
    // The placeholder covering an excluded display has to read as a word, not as noise:
    // a pet shown an unlabelled grey rectangle will guess what was behind it.
    const seen = new Set<string>();
    for (const letter of 'BLOCKED') {
      const canvas = createCanvas(8, 8, BLACK);
      drawLabel(canvas, letter, 0, 0, 1, WHITE, BLACK);
      seen.add(signature(canvas));
    }

    // BLOCKED has six distinct letters; the second C of the word is the repeat.
    expect(seen.size).toBe(new Set('BLOCKED').size);
    expect(seen.size).toBe(7);
  });

  it('renders the whole word without dropping a letter', () => {
    const size = labelSize('BLOCKED', 1);
    const canvas = createCanvas(size.width + 2, size.height + 2, BLACK);
    drawLabel(canvas, 'BLOCKED', 0, 0, 1, WHITE, BLACK);

    // Each of the seven glyph cells must have ink in it. A missing entry in the font
    // table would leave one cell blank and the word would still look plausible.
    for (let index = 0; index < 7; index += 1) {
      const left = 1 + index * 4;
      let lit = 0;
      for (let y = 1; y < 6; y += 1) {
        for (let x = left; x < left + 3; x += 1) {
          if (pixelAt(canvas, x, y).r === 255) lit += 1;
        }
      }
      expect(lit, `glyph ${index} of BLOCKED is blank`).toBeGreaterThan(0);
    }
  });

  it('separates the digits of a two-digit label', () => {
    const canvas = createCanvas(20, 10, BLACK);
    drawLabel(canvas, '11', 0, 0, 1, WHITE, BLACK);

    const wide = signature(canvas);
    const narrow = (() => {
      const single = createCanvas(20, 10, BLACK);
      drawLabel(single, '1', 0, 0, 1, WHITE, BLACK);
      return signature(single);
    })();
    expect(wide).not.toBe(narrow);
    expect(litPixels(canvas)).toBeGreaterThan(0);
  });

  it('scales the glyph up without changing its shape', () => {
    const small = createCanvas(8, 8, BLACK);
    drawLabel(small, '7', 0, 0, 1, WHITE, BLACK);
    const large = createCanvas(16, 16, BLACK);
    drawLabel(large, '7', 0, 0, 2, WHITE, BLACK);

    // Every glyph pixel becomes a 2x2 block, so exactly four times as many are lit.
    expect(litPixels(large)).toBe(litPixels(small) * 4);
  });

  it('paints a background behind the glyph so it reads over a screenshot', () => {
    // The label sits on top of captured pixels. Without a backing box a white glyph
    // vanishes against a white document.
    const canvas = createCanvas(20, 20, WHITE);
    drawLabel(canvas, '5', 0, 0, 1, WHITE, BLACK);

    const size = labelSize('5', 1);
    let dark = 0;
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        if (pixelAt(canvas, x, y).r === 0) dark += 1;
      }
    }
    expect(dark).toBeGreaterThan(0);
  });

  it('clips at the canvas edge instead of throwing', () => {
    // A composite slot can be smaller than the label when a monitor is tiny or the
    // virtual desktop is very wide. A clipped label beats an aborted composite.
    const canvas = createCanvas(4, 4, BLACK);
    expect(() => drawLabel(canvas, '8', 2, 2, 3, WHITE, BLACK)).not.toThrow();
    expect(canvas.data.length).toBe(4 * 4 * 4);
  });

  it('ignores characters it has no glyph for', () => {
    const canvas = createCanvas(12, 12, BLACK);
    expect(() => drawLabel(canvas, 'x', 0, 0, 1, WHITE, BLACK)).not.toThrow();
  });
});
