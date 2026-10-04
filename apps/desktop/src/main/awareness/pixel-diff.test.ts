import { describe, expect, it } from 'vitest';
import { createCanvas } from '../platform/canvas';
import type { Bitmap } from '../platform/canvas';
import { cropBitmap, diffBitmaps } from './pixel-diff';

const GREY = { r: 40, g: 40, b: 40, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

function paint(bitmap: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
  const copy = { ...bitmap, data: Buffer.from(bitmap.data) };
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * copy.width + column) * 4;
      copy.data[offset] = WHITE.b;
      copy.data[offset + 1] = WHITE.g;
      copy.data[offset + 2] = WHITE.r;
    }
  }
  return copy;
}

describe('diffBitmaps', () => {
  const before = createCanvas(100, 50, GREY);

  it('reports nothing changed for identical frames', () => {
    const result = diffBitmaps(before, createCanvas(100, 50, GREY));
    expect(result.ratio).toBe(0);
    expect(result.box).toBeUndefined();
  });

  it('measures the changed share and its bounding box', () => {
    const after = paint(before, 10, 5, 20, 10);
    const result = diffBitmaps(before, after);
    expect(result.ratio).toBeCloseTo(200 / 5000, 5);
    expect(result.box).toEqual({ x: 10, y: 5, width: 20, height: 10 });
  });

  it('ignores noise under the tolerance, like compression shimmer', () => {
    const after = createCanvas(100, 50, { r: 44, g: 41, b: 38, a: 255 });
    expect(diffBitmaps(before, after).ratio).toBe(0);
  });

  it('measures within a region, as a share of the region', () => {
    const after = paint(before, 10, 5, 20, 10);
    const result = diffBitmaps(before, after, { x: 0, y: 0, width: 40, height: 25 });
    expect(result.ratio).toBeCloseTo(200 / 1000, 5);
    // A change outside the region is not seen at all.
    const outside = diffBitmaps(before, after, { x: 50, y: 0, width: 50, height: 50 });
    expect(outside.ratio).toBe(0);
  });

  it('clamps a region that runs off the frame', () => {
    const after = paint(before, 90, 40, 10, 10);
    const result = diffBitmaps(before, after, { x: 80, y: 30, width: 500, height: 500 });
    expect(result.ratio).toBeCloseTo(100 / 400, 5);
  });

  it('calls frames of different sizes wholly changed: the display was resized', () => {
    const result = diffBitmaps(before, createCanvas(80, 50, GREY));
    expect(result.ratio).toBe(1);
    expect(result.box).toEqual({ x: 0, y: 0, width: 80, height: 50 });
  });
});

describe('cropBitmap', () => {
  it('copies out one rectangle', () => {
    const source = paint(createCanvas(10, 10, GREY), 2, 2, 3, 3);
    const crop = cropBitmap(source, { x: 2, y: 2, width: 3, height: 3 });
    expect(crop.width).toBe(3);
    expect(crop.height).toBe(3);
    expect(crop.data[0]).toBe(WHITE.b);
    expect(crop.data.length).toBe(36);
  });
});
