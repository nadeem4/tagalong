/** Tests for the canvas: creating and blitting bitmaps. */

import { describe, expect, it } from 'vitest';

import { blit, createCanvas, pixelAt } from './canvas';
import type { Bitmap, Colour } from './canvas';

const BLACK: Colour = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: Colour = { r: 255, g: 255, b: 255, a: 255 };
const RED: Colour = { r: 255, g: 0, b: 0, a: 255 };

/** A bitmap of one flat colour, standing in for a captured display. */
function solid(width: number, height: number, colour: Colour): Bitmap {
  return createCanvas(width, height, colour);
}

describe('createCanvas', () => {
  it('fills every pixel with the given colour', () => {
    const canvas = createCanvas(3, 2, RED);

    expect(canvas.width).toBe(3);
    expect(canvas.height).toBe(2);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        expect(pixelAt(canvas, x, y)).toEqual(RED);
      }
    }
  });

  it('allocates four bytes per pixel', () => {
    // Electron's nativeImage bitmaps are BGRA. createFromBitmap reads exactly
    // width * height * 4 and throws on anything shorter.
    expect(createCanvas(7, 5, BLACK).data.length).toBe(7 * 5 * 4);
  });

  it('writes BGRA byte order, not RGBA', () => {
    // Getting this backwards is invisible in greyscale test fixtures and turns every
    // real screenshot blue, so it is asserted on the raw bytes rather than through
    // pixelAt, which would agree with whatever order the writer used.
    const canvas = createCanvas(1, 1, { r: 1, g: 2, b: 3, a: 4 });

    expect([...canvas.data]).toEqual([3, 2, 1, 4]);
  });
});

describe('blit', () => {
  it('copies the source into the destination at the offset', () => {
    const dest = solid(4, 4, BLACK);
    blit(dest, solid(2, 2, WHITE), 1, 1);

    expect(pixelAt(dest, 0, 0)).toEqual(BLACK);
    expect(pixelAt(dest, 1, 1)).toEqual(WHITE);
    expect(pixelAt(dest, 2, 2)).toEqual(WHITE);
    expect(pixelAt(dest, 3, 3)).toEqual(BLACK);
  });

  it('leaves the destination untouched outside the copied rectangle', () => {
    const dest = solid(3, 3, BLACK);
    blit(dest, solid(1, 1, WHITE), 1, 1);

    let white = 0;
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if (pixelAt(dest, x, y).r === 255) white += 1;
      }
    }
    expect(white).toBe(1);
  });

  it('clips a source that runs past the right and bottom edges', () => {
    // The layout guarantees slots fit, but a capturer is free to treat thumbnailSize as
    // a hint and hand back a bitmap a pixel or two larger. Clipping keeps that from
    // writing past the end of the buffer or wrapping onto the next row.
    const dest = solid(3, 3, BLACK);
    expect(() => blit(dest, solid(5, 5, WHITE), 1, 1)).not.toThrow();

    expect(pixelAt(dest, 2, 2)).toEqual(WHITE);
    expect(pixelAt(dest, 0, 0)).toEqual(BLACK);
    expect(dest.data.length).toBe(3 * 3 * 4);
  });

  it('clips a source placed at a negative offset', () => {
    const dest = solid(3, 3, BLACK);
    blit(dest, solid(2, 2, WHITE), -1, -1);

    // Only the source's bottom-right pixel lands on the canvas.
    expect(pixelAt(dest, 0, 0)).toEqual(WHITE);
    expect(pixelAt(dest, 1, 0)).toEqual(BLACK);
    expect(pixelAt(dest, 0, 1)).toEqual(BLACK);
  });

  it('does nothing when the source lands entirely off the canvas', () => {
    const dest = solid(2, 2, BLACK);
    blit(dest, solid(2, 2, WHITE), 5, 5);
    blit(dest, solid(2, 2, WHITE), -9, 0);

    expect([...dest.data]).toEqual([...solid(2, 2, BLACK).data]);
  });

  it('copies rows independently, so a narrow source does not smear across the canvas', () => {
    // The bug this catches: copying width*height*4 bytes in one go when the source and
    // destination have different widths, which diagonally shears the image.
    const dest = solid(4, 3, BLACK);
    blit(dest, solid(2, 3, WHITE), 0, 0);

    for (let y = 0; y < 3; y += 1) {
      expect(pixelAt(dest, 1, y)).toEqual(WHITE);
      expect(pixelAt(dest, 2, y)).toEqual(BLACK);
    }
  });
});
