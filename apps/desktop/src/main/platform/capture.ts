import { fitWithin } from './downscale';
import type { PixelSize } from './downscale';
import type { ActiveWindowInfo, CapturedImage, WindowBounds } from './index';

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

/** One capturable surface. The snake_case `display_id` is Electron's own spelling. */
export interface CaptureSource {
  name: string;
  display_id: string;
  thumbnail: CaptureImagePort;
}

export interface DesktopCapturerPort {
  getSources(options: {
    types: Array<'window' | 'screen'>;
    thumbnailSize: PixelSize;
  }): Promise<CaptureSource[]>;
}

export interface ScreenPort {
  getDisplayMatching(bounds: WindowBounds): { id: number };
}

export interface WindowCaptureDeps {
  desktopCapturer: DesktopCapturerPort;
  screen: ScreenPort;
  getActiveWindow: () => Promise<ActiveWindowInfo | null>;
  log?: (message: string) => void;
}

/** Electron leaves the thumbnail empty for a window it was not allowed to read. */
function usable(source: CaptureSource): boolean {
  const { width, height } = source.thumbnail.getSize();
  return !source.thumbnail.isEmpty() && width > 0 && height > 0;
}

/**
 * Picks the source showing the active window, or the display it sits on.
 *
 * Electron's window ids come from its own capturer and have nothing in common with the
 * ids `get-windows` reports, so the title is the only handle the two share. Titles change
 * while the user works and duplicate across tabs, which is why the display fallback
 * exists at all: a screenshot of the right monitor beats no screenshot.
 */
async function pickSource(
  deps: WindowCaptureDeps,
  active: ActiveWindowInfo,
  thumbnailSize: PixelSize,
): Promise<CaptureSource | null> {
  const windows = await deps.desktopCapturer.getSources({ types: ['window'], thumbnailSize });
  const match = windows.find((source) => source.name === active.title && usable(source));
  if (match !== undefined) return match;

  const display = deps.screen.getDisplayMatching(active.bounds);
  const screens = await deps.desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const onDisplay = screens.find(
    (source) => source.display_id === String(display.id) && usable(source),
  );
  // Windows sometimes reports a blank display_id, so a single usable screen still counts.
  return onDisplay ?? screens.find(usable) ?? null;
}

/**
 * Captures the active window as a PNG no larger than `maxLongSide` on its long side.
 *
 * The bound is pushed into the capturer request rather than applied afterwards: asking
 * for a full 4K bitmap only to shrink it costs tens of megabytes per look. The resize
 * after the fact is the safety net for capturers that treat `thumbnailSize` as a hint.
 */
export async function captureActiveWindowImageWith(
  deps: WindowCaptureDeps,
  maxLongSide: number,
): Promise<CapturedImage | null> {
  const log = deps.log ?? (() => {});
  const active = await deps.getActiveWindow();
  if (active === null) {
    log('captureActiveWindowImage: no active window');
    return null;
  }

  const requested = fitWithin(active.bounds.width, active.bounds.height, maxLongSide);
  const source = await pickSource(deps, active, requested);
  if (source === null) {
    log(`captureActiveWindowImage: nothing capturable for '${active.title}'`);
    return null;
  }

  const size = source.thumbnail.getSize();
  const target = fitWithin(size.width, size.height, maxLongSide);
  const resized =
    target.width === size.width && target.height === size.height
      ? source.thumbnail
      : source.thumbnail.resize(target);

  log(`captureActiveWindowImage: '${source.name}' ${target.width}x${target.height}`);
  return {
    base64: resized.toPNG().toString('base64'),
    width: target.width,
    height: target.height,
  };
}
