/**
 * Screenshot of one listed window, through Electron's desktopCapturer. Contains
 * captureWindowImageWith.
 */

import { fitWithin } from './downscale';
import type { PixelSize } from './downscale';
import type { CapturedImage } from './index';

/**
 * The slice of Electron's NativeImage this capture needs, so tests can hand over their
 * own bitmap and no test needs a display.
 */
export interface CaptureImagePort {
  isEmpty(): boolean;
  getSize(): PixelSize;
  resize(size: PixelSize): CaptureImagePort;
  toPNG(): Buffer;
}

/** One capturable window. The snake_case `display_id` is Electron's own spelling. */
export interface CaptureSource {
  /** On Windows `window:<handle>:0` for a window, which is how a listed window is found. */
  id?: string;
  name: string;
  display_id: string;
  thumbnail: CaptureImagePort;
}

interface DesktopCapturerPort {
  getSources(options: {
    types: Array<'window'>;
    thumbnailSize: PixelSize;
  }): Promise<CaptureSource[]>;
}

export interface WindowCaptureDeps {
  desktopCapturer: DesktopCapturerPort;
  log?: (message: string) => void;
}

/** Electron leaves the thumbnail empty for a window it was not allowed to read. */
function usable(source: CaptureSource): boolean {
  const { width, height } = source.thumbnail.getSize();
  return !source.thumbnail.isEmpty() && width > 0 && height > 0;
}

/**
 * Captures one window by its handle, as `list_windows` named it, whether it is in front or
 * behind others. A minimized window has nothing drawn, so it comes back null.
 *
 * Exclusions are the caller's to check, against the classified window list, before this
 * runs: the pixels of a blind spot are never read at all.
 */
export async function captureWindowImageWith(
  deps: WindowCaptureDeps,
  handle: number,
  maxLongSide: number,
): Promise<CapturedImage | null> {
  const sources = await deps.desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: maxLongSide, height: maxLongSide },
  });
  const source = sources.find((s) => s.id?.startsWith(`window:${handle}:`) === true && usable(s));
  if (source === undefined) {
    deps.log?.(`captureWindowImage: nothing capturable for window ${handle}`);
    return null;
  }
  return encode(source, maxLongSide);
}

/** The source's thumbnail as a PNG inside the bound. */
function encode(source: CaptureSource, maxLongSide: number): CapturedImage {
  const size = source.thumbnail.getSize();
  const target = fitWithin(size.width, size.height, maxLongSide);
  const resized =
    target.width === size.width && target.height === size.height
      ? source.thumbnail
      : source.thumbnail.resize(target);
  return {
    base64: resized.toPNG().toString('base64'),
    width: target.width,
    height: target.height,
  };
}
