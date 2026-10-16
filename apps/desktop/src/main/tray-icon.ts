/** The tray icon, drawn in code. Contains createTrayIcon. */

import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';

const SIZE = 16;

/**
 * Draws the tray icon in code rather than shipping a PNG.
 *
 * Electron refuses to create a Tray from an empty image, and a build that silently loses
 * an asset file would fail at launch instead of at build time. A filled dot is enough for
 * a tray icon.
 */
export function createTrayIcon(): NativeImage {
  // createFromBitmap takes premultiplied BGRA.
  const bitmap = Buffer.alloc(SIZE * SIZE * 4);
  const centre = (SIZE - 1) / 2;
  const radius = SIZE / 2 - 1;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inside = (x - centre) ** 2 + (y - centre) ** 2 <= radius ** 2;
      const offset = (y * SIZE + x) * 4;
      bitmap[offset] = inside ? 0xe0 : 0x00; // blue
      bitmap[offset + 1] = inside ? 0x88 : 0x00; // green
      bitmap[offset + 2] = inside ? 0x22 : 0x00; // red
      bitmap[offset + 3] = inside ? 0xff : 0x00; // alpha
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width: SIZE, height: SIZE });
}
