/**
 * Pixel comparison for watches: how much of a region changed between two frames, and where.
 * Contains diffBitmaps and cropBitmap.
 */

import type { Bitmap } from '../platform/canvas';

/** A rectangle in one bitmap's pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BitmapDiff {
  /** Changed pixels as a share of the compared area, 0 to 1. */
  ratio: number;
  /** The smallest rectangle holding every changed pixel. Absent when nothing changed. */
  box?: PixelRect;
}

/**
 * How far a channel may move before the pixel counts as changed.
 *
 * Frames are downscaled screenshots, so anti-aliasing and the resampler shimmer by a few
 * levels between two captures of a screen nobody touched. A cursor blink or a scrolled
 * line moves by far more than this.
 */
const CHANNEL_TOLERANCE = 24;
const BYTES_PER_PIXEL = 4;

function clamp(rect: PixelRect, width: number, height: number): PixelRect | null {
  const left = Math.max(0, Math.min(rect.x, width));
  const top = Math.max(0, Math.min(rect.y, height));
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Compares two frames of the same display, optionally inside one region.
 *
 * Plain buffer arithmetic over Electron's BGRA layout, so it runs in tests with no display.
 * Frames of different sizes are reported as wholly changed rather than compared: the
 * display was resized or rescaled, and a pixel-by-pixel answer would be noise.
 */
export function diffBitmaps(before: Bitmap, after: Bitmap, region?: PixelRect): BitmapDiff {
  if (before.width !== after.width || before.height !== after.height) {
    return { ratio: 1, box: { x: 0, y: 0, width: after.width, height: after.height } };
  }

  const area = clamp(
    region ?? { x: 0, y: 0, width: after.width, height: after.height },
    after.width,
    after.height,
  );
  if (area === null) return { ratio: 0 };

  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      const offset = (y * after.width + x) * BYTES_PER_PIXEL;
      const moved =
        Math.abs(before.data[offset]! - after.data[offset]!) > CHANNEL_TOLERANCE ||
        Math.abs(before.data[offset + 1]! - after.data[offset + 1]!) > CHANNEL_TOLERANCE ||
        Math.abs(before.data[offset + 2]! - after.data[offset + 2]!) > CHANNEL_TOLERANCE;
      if (!moved) continue;
      changed += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (changed === 0) return { ratio: 0 };
  return {
    ratio: changed / (area.width * area.height),
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

/** Copies one rectangle out of a bitmap. The rectangle must lie inside it. */
export function cropBitmap(source: Bitmap, rect: PixelRect): Bitmap {
  const data = Buffer.alloc(rect.width * rect.height * BYTES_PER_PIXEL);
  for (let row = 0; row < rect.height; row += 1) {
    const from = ((rect.y + row) * source.width + rect.x) * BYTES_PER_PIXEL;
    source.data.copy(
      data,
      row * rect.width * BYTES_PER_PIXEL,
      from,
      from + rect.width * BYTES_PER_PIXEL,
    );
  }
  return { data, width: rect.width, height: rect.height };
}
