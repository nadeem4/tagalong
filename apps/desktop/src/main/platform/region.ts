import type { DisplayBounds } from '@tagalong/protocol';

import type { DisplayImagePort, DisplayInfo, DisplaySource } from './displays';
import { fitWithin } from './downscale';
import type { PixelSize } from './downscale';
import type { CapturedImage } from './index';

/**
 * The ports a crop needs. Narrower than a full display capture: no exclusions, because
 * `look_closer` is only ever reached through a display the pet already listed, and that
 * listing is where a blocked display is refused.
 */
export interface RegionCaptureDeps {
  screen: {
    getAllDisplays(): DisplayInfo[];
  };
  desktopCapturer: {
    getSources(options: {
      types: Array<'screen'>;
      thumbnailSize: PixelSize;
    }): Promise<DisplaySource[]>;
  };
  log?: (message: string) => void;
}

export interface RegionCaptureParams {
  displayId: number;
  /** In that display's own pixels, relative to its top-left corner. */
  rect: DisplayBounds;
  maxLongSide: number;
}

/**
 * Captures one rectangle of one display at native resolution.
 *
 * The capturer is asked for the display at its full pixel size rather than the usual
 * 1568-pixel thumbnail. That is the entire point of the tool: cropping a thumbnail of a
 * 4K monitor returns a blur, which is what the pet was trying to escape by leaning in.
 * The bound is applied to the crop afterwards, so a small rectangle comes back sharp and
 * a large one is still capped at the same ceiling as every other image.
 *
 * Returns null rather than throwing on every miss — an unknown display, a capturer with
 * no source for it, a rectangle entirely off the screen. A model can name a display that
 * closed between one tool call and the next, and the honest answer is a refusal the pet
 * can repeat, not a turn that dies.
 */
export async function captureRegionWith(
  deps: RegionCaptureDeps,
  params: RegionCaptureParams,
): Promise<CapturedImage | null> {
  const log = deps.log ?? (() => {});
  const display = deps.screen
    .getAllDisplays()
    .find((candidate) => candidate.id === params.displayId);
  if (display === undefined) {
    log(`captureRegion: no display ${params.displayId}`);
    return null;
  }

  // Bounds are device-independent; the capturer works in real pixels, so a 200% monitor
  // needs twice the numbers or the crop lands at half the intended place.
  const full = {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };

  const rect = clampToDisplay(params.rect, full);
  if (rect === null) {
    log(`captureRegion: the rectangle lies entirely off display ${params.displayId}`);
    return null;
  }

  const sources = await deps.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full });
  const source = sources.find((candidate) => candidate.display_id === String(params.displayId));
  if (source === undefined || source.thumbnail.isEmpty()) {
    log(`captureRegion: no usable source for display ${params.displayId}`);
    return null;
  }

  const cropped = source.thumbnail.crop(rect);
  const size = cropped.getSize();
  const target = fitWithin(size.width, size.height, params.maxLongSide);
  const fitted: DisplayImagePort =
    target.width === size.width && target.height === size.height ? cropped : cropped.resize(target);

  log(`captureRegion: display ${params.displayId} ${target.width}x${target.height}`);
  return {
    base64: fitted.toPNG().toString('base64'),
    width: target.width,
    height: target.height,
  };
}

/**
 * Trims a rectangle to the part of it that is actually on the display.
 *
 * A model works from a listing of sizes, not from pixels, so it will sometimes ask for a
 * box that runs off an edge. Clamping returns the part that exists; only a rectangle with
 * nothing left is a refusal.
 */
function clampToDisplay(rect: DisplayBounds, display: PixelSize): DisplayBounds | null {
  const left = Math.max(0, Math.min(rect.x, display.width));
  const top = Math.max(0, Math.min(rect.y, display.height));
  const right = Math.min(display.width, rect.x + rect.width);
  const bottom = Math.min(display.height, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
