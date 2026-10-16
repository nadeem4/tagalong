/**
 * The disk for a drop: Node reads the file, Electron's nativeImage decodes a picture and
 * scales it to a PNG. Only called once the person has pressed a button on the drop card.
 * Contains nodeDropFs, the DropFs main passes to dropDesk.
 */

import { readFile, stat } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { DropFs } from './drop';

export const nodeDropFs: DropFs = {
  async size(path) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${path} is not a file`);
    return info.size;
  },
  readText: (path) => readFile(path, 'utf8'),
  async readImage(path, maxLongSide) {
    let image = nativeImage.createFromBuffer(await readFile(path));
    if (image.isEmpty()) throw new Error(`${path} is not a picture Tagalong can read`);
    const { width, height } = image.getSize();
    if (Math.max(width, height) > maxLongSide) {
      image = image.resize(width >= height ? { width: maxLongSide } : { height: maxLongSide });
    }
    const size = image.getSize();
    return {
      mime: 'image/png',
      base64: image.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
    };
  },
};
