import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';

import { displayRefusals } from './displays';
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
  /** On Windows `window:<handle>:0` for a window, which is how a listed window is found. */
  id?: string;
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
  /** For the screen fallback: a display with a blocked window on it is never photographed. */
  listWindows: () => Promise<readonly WindowEntry[]>;
  exclusions: CaptureExclusions;
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
 *
 * `active` may be null. Windows reports no foreground window more often than it sounds —
 * a locked or disconnected session, a UAC prompt sitting on the secure desktop, a
 * full-screen exclusive game — and on some machines the call never succeeds at all. The
 * exclusion rules already decided what to do with a window they cannot name: allow it,
 * because refusing everything unidentifiable is a pet that never sees. So a nameless
 * foreground window falls through to a screen rather than ending the capture.
 */
async function pickSource(
  deps: WindowCaptureDeps,
  active: ActiveWindowInfo | null,
  thumbnailSize: PixelSize,
): Promise<CaptureSource | null> {
  if (active !== null) {
    const windows = await deps.desktopCapturer.getSources({ types: ['window'], thumbnailSize });
    const match = windows.find((source) => source.name === active.title && usable(source));
    if (match !== undefined) return match;
  }

  // A whole screen shows more than the window: the same per-display refusal as a full view
  // runs first, and a screen it cannot place is refused while anything at all is blocked.
  // No screenshot beats a leaked one.
  const refusalFor = await displayRefusals(deps);
  const allowed = (source: CaptureSource): boolean => {
    const id = Number(source.display_id);
    const refused =
      source.display_id === '' || !Number.isFinite(id)
        ? (refusalFor.any ?? null)
        : refusalFor(id).refusal;
    return usable(source) && refused === null;
  };
  const screens = await deps.desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (active !== null) {
    const display = deps.screen.getDisplayMatching(active.bounds);
    const onDisplay = screens.find((source) => source.display_id === String(display.id));
    if (onDisplay !== undefined && usable(onDisplay)) return allowed(onDisplay) ? onDisplay : null;
  }
  // Windows sometimes reports a blank display_id, so a single usable screen still counts.
  return screens.find(allowed) ?? null;
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
  if (active === null) log('captureActiveWindowImage: no active window, falling back to a screen');

  // With no window there are no bounds to shape the request, so the bound itself is the
  // box: the capturer fits the frame inside it and keeps the aspect ratio.
  const requested =
    active === null
      ? { width: maxLongSide, height: maxLongSide }
      : fitWithin(active.bounds.width, active.bounds.height, maxLongSide);
  const source = await pickSource(deps, active, requested);
  if (source === null) {
    log(`captureActiveWindowImage: nothing capturable for '${active?.title ?? 'the desktop'}'`);
    return null;
  }

  const image = encode(source, maxLongSide);
  log(`captureActiveWindowImage: '${source.name}' ${image.width}x${image.height}`);
  return image;
}

/**
 * Captures one window by its handle, as `list_windows` named it, whether it is in front or
 * behind others. A minimized window has nothing drawn, so it comes back null.
 *
 * Exclusions are the caller's to check, against the classified window list, before this
 * runs: the pixels of a blind spot are never read at all.
 */
export async function captureWindowImageWith(
  deps: Pick<WindowCaptureDeps, 'desktopCapturer' | 'log'>,
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
