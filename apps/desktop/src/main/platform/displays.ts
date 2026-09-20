import { findCaptureBlock } from '@tagalong/core';
import type { CaptureBlock } from '@tagalong/core';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';

import { blit, createCanvas } from './canvas';
import type { Bitmap, Colour } from './canvas';
import { layoutComposite } from './composite';
import { fitWithin } from './downscale';
import type { PixelSize } from './downscale';
import type { ActiveWindowInfo, CapturedImage, WindowBounds } from './index';
import { drawLabel, labelSize } from './label';

/** What `screen.getAllDisplays()` gives us, narrowed to the fields this capture uses. */
export interface DisplayInfo {
  id: number;
  bounds: WindowBounds;
  scaleFactor: number;
  primary: boolean;
}

/**
 * A capturer thumbnail. Extends the window capture's port with `toBitmap`, which the
 * composite needs and a plain screenshot does not.
 */
export interface DisplayImagePort {
  isEmpty(): boolean;
  getSize(): PixelSize;
  resize(size: PixelSize): DisplayImagePort;
  toPNG(): Buffer;
  toBitmap(): Buffer;
}

export interface DisplaySource {
  name: string;
  /** Electron's own snake_case spelling, matched against `String(display.id)`. */
  display_id: string;
  thumbnail: DisplayImagePort;
}

export interface DisplaysCaptureDeps {
  screen: {
    getAllDisplays(): DisplayInfo[];
    getDisplayMatching(bounds: WindowBounds): { id: number };
  };
  desktopCapturer: {
    getSources(options: {
      types: Array<'screen'>;
      thumbnailSize: PixelSize;
    }): Promise<DisplaySource[]>;
  };
  getActiveWindow(): Promise<ActiveWindowInfo | null>;
  /**
   * The window inventory, already classified against the exclusion list.
   *
   * Required rather than optional. It is what lets a display be blanked for a window that
   * is not the focused one, and an optional dependency whose absence silently weakens a
   * privacy guarantee is the wrong shape for that: a caller that forgot it would look
   * like a caller that opted out.
   */
  listWindows(): Promise<readonly WindowEntry[]>;
  exclusions: CaptureExclusions;
  /** `nativeImage.createFromBitmap(bitmap).toPNG()`. The only Electron call the composite makes. */
  encodePng(bitmap: Bitmap): Buffer;
  log?: (message: string) => void;
}

export interface CapturedDisplay {
  id: number;
  bounds: WindowBounds;
  scaleFactor: number;
  primary: boolean;
  /** True for the display holding the foreground window, if Windows reports one. */
  focused: boolean;
  /** Which exclusion entry refused this display, so the UI can say why rather than "blocked". */
  blocked: CaptureBlock | null;
  /** Null when the capturer offered no usable source for this display. */
  image: CapturedImage | null;
}

export interface DisplaysCapture {
  displays: CapturedDisplay[];
  composite: CapturedImage | null;
}

/** The composite's backdrop, shown wherever the monitors do not tile the bounding box. */
const GUTTER: Colour = { r: 24, g: 24, b: 27, a: 255 };
/** The flat fill of an excluded display, dark enough that the white label reads over it. */
const BLOCKED_FILL: Colour = { r: 63, g: 63, b: 70, a: 255 };
const LABEL_INK: Colour = { r: 255, g: 255, b: 255, a: 255 };
const LABEL_BACKING: Colour = { r: 0, g: 0, b: 0, a: 255 };

/**
 * Big enough to read on a 1568-wide composite, small enough not to swallow a narrow slot.
 * A fixed scale cannot do both: it is either invisible on a three-monitor composite or
 * larger than the slot on a ten-monitor one.
 */
function labelScale(slotHeight: number): number {
  return Math.max(1, Math.min(6, Math.round(slotHeight / 60)));
}

/** Electron leaves the thumbnail empty for a surface it was not allowed to read. */
function usable(source: DisplaySource): boolean {
  const { width, height } = source.thumbnail.getSize();
  return !source.thumbnail.isEmpty() && width > 0 && height > 0;
}

function toCapturedImage(image: DisplayImagePort): CapturedImage {
  const { width, height } = image.getSize();
  return { base64: image.toPNG().toString('base64'), width, height };
}

/** A flat panel reading BLOCKED, standing in for a display Tagalong may not photograph. */
function blockedPanel(size: PixelSize): Bitmap {
  const panel = createCanvas(size.width, size.height, BLOCKED_FILL);
  const scale = labelScale(size.height);
  const text = labelSize('BLOCKED', scale);
  drawLabel(
    panel,
    'BLOCKED',
    Math.max(0, Math.round((size.width - text.width) / 2)),
    Math.max(0, Math.round((size.height - text.height) / 2)),
    scale,
    LABEL_INK,
    LABEL_BACKING,
  );
  return panel;
}

/**
 * Which displays hold a visible excluded window, and which entry refused each.
 *
 * Minimized windows are skipped. A minimized vault is not on screen, and blanking a
 * monitor the user is actively working on because something is hidden in the taskbar is a
 * bug rather than caution. A window the host could not place on a display is skipped for
 * the same reason: guessing would blank an arbitrary monitor.
 */
function refusalsByDisplay(windows: readonly WindowEntry[]): Map<number, CaptureBlock> {
  const refusals = new Map<number, CaptureBlock>();
  for (const window of windows) {
    if (window.blocked === undefined) continue;
    if (window.state === 'minimized') continue;
    if (window.displayId === undefined) continue;
    if (!refusals.has(window.displayId)) refusals.set(window.displayId, window.blocked);
  }
  return refusals;
}

/**
 * Captures every display at once, plus a composite that shows how they are arranged.
 *
 * The capturer is asked for sources exactly once. `getSources` wakes the compositor for
 * every screen it enumerates, so calling it per display turns a three-monitor look into
 * three full enumerations.
 *
 * A display is blanked when **any window on it that the user can see** is excluded, not
 * only when the foreground window is. Phase 2 checked the foreground window alone, which
 * was sufficient while a capture only ever framed that window; capturing every display at
 * once puts unfocused windows in frame, and a password manager open on a second monitor
 * was going to the model in full.
 *
 * The foreground check stays as a floor beneath the inventory. If the enumeration fails —
 * PowerShell missing, blocked by policy, an accessibility tree that will not answer — the
 * protection Phase 2 already shipped must not quietly disappear with it.
 */
export async function captureDisplaysWith(
  deps: DisplaysCaptureDeps,
  maxLongSide: number,
): Promise<DisplaysCapture> {
  const log = deps.log ?? (() => {});
  const displays = deps.screen.getAllDisplays();
  if (displays.length === 0) {
    log('captureDisplays: the session reports no displays');
    return { displays: [], composite: null };
  }

  const [active, windows] = await Promise.all([deps.getActiveWindow(), deps.listWindows()]);
  const blocked = findCaptureBlock(
    active === null ? undefined : { processName: active.appName, title: active.title },
    deps.exclusions,
  );
  const focusedId = active === null ? null : deps.screen.getDisplayMatching(active.bounds).id;
  const blockedByWindow = refusalsByDisplay(windows);

  // The bound goes into the request rather than being applied afterwards: asking for three
  // full 4K bitmaps only to shrink them costs tens of megabytes a look.
  const sources = await deps.desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxLongSide, height: maxLongSide },
  });

  const captured: CapturedDisplay[] = displays.map((display) => {
    const focused = focusedId !== null && display.id === focusedId;
    const refusal = blockedByWindow.get(display.id) ?? (focused ? blocked : null);
    const source = sources.find((candidate) => candidate.display_id === String(display.id));

    if (refusal !== null) {
      const size = fitWithin(display.bounds.width, display.bounds.height, maxLongSide);
      log(`captureDisplays: display ${display.id} blocked by ${refusal.entry}`);
      return {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        primary: display.primary,
        focused,
        blocked: refusal,
        image: {
          base64: deps.encodePng(blockedPanel(size)).toString('base64'),
          width: size.width,
          height: size.height,
        },
      };
    }

    if (source === undefined || !usable(source)) {
      log(`captureDisplays: no usable source for display ${display.id}`);
      return {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        primary: display.primary,
        focused,
        blocked: null,
        image: null,
      };
    }

    const size = source.thumbnail.getSize();
    const target = fitWithin(size.width, size.height, maxLongSide);
    const fitted =
      target.width === size.width && target.height === size.height
        ? source.thumbnail
        : source.thumbnail.resize(target);

    return {
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      primary: display.primary,
      focused,
      blocked: null,
      image: toCapturedImage(fitted),
    };
  });

  return {
    displays: captured,
    composite: buildComposite(deps, displays, captured, sources, maxLongSide),
  };
}

/**
 * Draws every display into one canvas laid out by monitor geometry, each labelled with its
 * position in the list.
 *
 * The label is an ordinal rather than Electron's display id: ids are ten-digit numbers that
 * cost seven glyphs of a five-pixel font to draw and mean nothing to the user. The context
 * text carries the mapping from ordinal to id so the pet can still name a display when it
 * calls `look_at_display`.
 */
function buildComposite(
  deps: DisplaysCaptureDeps,
  displays: DisplayInfo[],
  captured: CapturedDisplay[],
  sources: DisplaySource[],
  maxLongSide: number,
): CapturedImage | null {
  const layout = layoutComposite(displays, maxLongSide);
  if (layout.width === 0 || layout.height === 0) return null;

  const canvas = createCanvas(layout.width, layout.height, GUTTER);

  layout.slots.forEach((slot, index) => {
    const display = captured.find((candidate) => candidate.id === slot.id);
    const size = { width: slot.width, height: slot.height };

    if (display?.blocked != null) {
      blit(canvas, blockedPanel(size), slot.x, slot.y);
    } else {
      const source = sources.find((candidate) => candidate.display_id === String(slot.id));
      // A display with no source keeps the gutter colour: an honest gap rather than a
      // stale or invented picture of a screen nothing could read.
      if (source !== undefined && usable(source)) {
        const scaled = source.thumbnail.resize(size);
        blit(canvas, { data: scaled.toBitmap(), ...size }, slot.x, slot.y);
      }
    }

    const scale = labelScale(slot.height);
    drawLabel(canvas, String(index + 1), slot.x, slot.y, scale, LABEL_INK, LABEL_BACKING);
  });

  return {
    base64: deps.encodePng(canvas).toString('base64'),
    width: layout.width,
    height: layout.height,
  };
}
