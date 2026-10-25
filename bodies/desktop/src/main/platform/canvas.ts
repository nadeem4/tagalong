/**
 * The little raster surface the composite is drawn on.
 *
 * Electron's `nativeImage` can resize and encode but cannot compose, and the composite is
 * the one image Tagalong builds rather than captures. Rather than take on an image library
 * for it, the pixels are handled directly: `nativeImage.toBitmap()` hands over a BGRA
 * buffer and `nativeImage.createFromBitmap()` takes one back, so everything in between is
 * ordinary buffer arithmetic that tests can drive with no display attached.
 * Contains Bitmap, createCanvas, blit and pixelAt (pixelAt is for tests).
 */
export interface Bitmap {
  /** BGRA, four bytes per pixel, rows top to bottom. Electron's own layout. */
  data: Buffer;
  width: number;
  height: number;
}

export interface Colour {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BYTES_PER_PIXEL = 4;

/** Allocates a bitmap with every pixel set to `colour`. */
export function createCanvas(width: number, height: number, colour: Colour): Bitmap {
  const data = Buffer.allocUnsafe(width * height * BYTES_PER_PIXEL);
  // Blue first: Electron's bitmaps are BGRA, and writing RGBA here is invisible against
  // grey fixtures but turns every real screenshot blue.
  for (let offset = 0; offset < data.length; offset += BYTES_PER_PIXEL) {
    data[offset] = colour.b;
    data[offset + 1] = colour.g;
    data[offset + 2] = colour.r;
    data[offset + 3] = colour.a;
  }
  return { data, width, height };
}

/** Reads one pixel. Out-of-bounds coordinates are a programming error, not a value. */
export function pixelAt(bitmap: Bitmap, x: number, y: number): Colour {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
    throw new RangeError(`(${x}, ${y}) is outside a ${bitmap.width}x${bitmap.height} bitmap`);
  }
  const offset = (y * bitmap.width + x) * BYTES_PER_PIXEL;
  return {
    b: bitmap.data[offset] ?? 0,
    g: bitmap.data[offset + 1] ?? 0,
    r: bitmap.data[offset + 2] ?? 0,
    a: bitmap.data[offset + 3] ?? 0,
  };
}

/**
 * Copies `source` onto `dest` with its top-left corner at (x, y), clipped to the canvas.
 *
 * Row by row, never as one block copy: source and destination have different widths, so a
 * single copy of `width * height * 4` bytes shears the image diagonally.
 *
 * Clipping rather than throwing is deliberate. The layout already guarantees each slot
 * fits, but `thumbnailSize` is a hint a capturer may round, and a display bitmap one pixel
 * wider than its slot should lose a pixel column, not corrupt the canvas or abort the
 * whole composite.
 */
export function blit(dest: Bitmap, source: Bitmap, x: number, y: number): void {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(dest.width, x + source.width);
  const endY = Math.min(dest.height, y + source.height);
  if (startX >= endX || startY >= endY) return;

  const rowBytes = (endX - startX) * BYTES_PER_PIXEL;
  for (let row = startY; row < endY; row += 1) {
    const sourceOffset = ((row - y) * source.width + (startX - x)) * BYTES_PER_PIXEL;
    const destOffset = (row * dest.width + startX) * BYTES_PER_PIXEL;
    source.data.copy(dest.data, destOffset, sourceOffset, sourceOffset + rowBytes);
  }
}
