import { nativeImage } from 'electron';
import type { ImageCodec } from './perception-memory';

/**
 * PNG decoding and encoding through Electron, the one part of awareness that needs it.
 *
 * `toBitmap` hands back BGRA, the layout `pixel-diff` reads; `createFromBitmap` takes the
 * same layout back.
 */
export const nativeCodec: ImageCodec = {
  decode(png) {
    const image = nativeImage.createFromBuffer(png);
    const { width, height } = image.getSize();
    return { data: image.toBitmap(), width, height };
  },
  encode(bitmap) {
    return nativeImage
      .createFromBitmap(bitmap.data, { width: bitmap.width, height: bitmap.height })
      .toPNG();
  },
};
