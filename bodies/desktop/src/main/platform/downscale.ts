/** Shrinks a size to fit a long side, never upscaling. Contains PixelSize and fitWithin. */

/** A pixel size, used both for what the OS handed back and for what we ask it to become. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Shrinks a size so its long side fits `maxLongSide`, keeping the aspect ratio.
 *
 * Vision models bill by pixels and gain nothing from a screenshot larger than their own
 * tiling grid, so the bound is a cost ceiling rather than a quality one. It is a ceiling
 * only: an image already inside it is returned untouched, because upscaling would invent
 * pixels that were never on screen and then charge the user for the invention.
 *
 * A rounded dimension is clamped to 1 — a sliver of a window is still an image, and the
 * protocol's screenshot block requires positive dimensions, so rounding to zero would
 * produce something no snapshot could carry.
 */
export function fitWithin(width: number, height: number, maxLongSide: number): PixelSize {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };

  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
