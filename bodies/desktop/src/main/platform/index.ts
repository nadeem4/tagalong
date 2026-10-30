/**
 * The Platform interface: everything the brain can ask this machine to perceive. Contains
 * Platform, its shapes (WindowBounds, ActiveWindowInfo, CapturedImage, WindowInventory) and
 * createPlatform. Windows is the only adapter.
 */

import type { CaptureExclusions } from '../../shared/settings';
import type { ScreenInfo, WindowEntry } from '@tagalong/ui/shapes';

import type { DisplaysCapture } from './displays';
import type { RegionCaptureParams } from './region';
import type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
import type { LookAtWindowAnswer } from './window-shot';
import type { WindowEnumerationFailure } from './window-list';
import { Win32Platform } from './win32';

/** Where the foreground window is, so the panel can open next to what the user is reading. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActiveWindowInfo {
  appName: string;
  title: string;
  bounds: WindowBounds;
}

export interface CapturedImage {
  base64: string;
  width: number;
  height: number;
}

/** Everything the brain can ask this machine to perceive. */
export interface Platform {
  getActiveWindow(): Promise<ActiveWindowInfo | null>;
  captureSelection(): Promise<string | null>;
  readClipboard(): Promise<string>;
  /**
   * Takes the exclusion list for its screen fallback: when no window matches, a whole screen
   * is used only if the per-display refusal allows it.
   */
  captureActiveWindowImage(
    maxLongSide: number,
    exclusions: CaptureExclusions,
  ): Promise<CapturedImage | null>;
  /**
   * Every display at once, plus a composite showing how they are arranged.
   *
   * Takes the exclusion list. `captureActiveWindowImage` uses it only for its screen
   * fallback; its caller checks the focused window first. Here one display can be refused
   * while the others are returned, and the composite has to show the refusal in that
   * display's slot, so the decision has to be made inside the capture rather than above it.
   */
  captureDisplays(maxLongSide: number, exclusions: CaptureExclusions): Promise<DisplaysCapture>;
  /**
   * Every top-level window, with no window text in it.
   *
   * Takes the exclusion list for the same reason `captureDisplays` does — one window is
   * refused while the rest are returned, so the decision belongs inside the enumeration.
   * Entries come back already classified, so nothing downstream has to remember to check.
   */
  listWindows(
    exclusions: CaptureExclusions,
    /** `countText: false` skips the text count, for keeping an eye: titles are all it needs. */
    options?: { countText?: boolean },
  ): Promise<WindowInventory>;
  /**
   * A native-resolution crop of one display, for leaning in.
   *
   * Takes the exclusion list like its neighbours: the model can name any display id, so a
   * crop runs the same per-display refusal as `captureDisplays` and returns null for a
   * blocked display.
   */
  captureRegion(
    params: RegionCaptureParams,
    exclusions: CaptureExclusions,
  ): Promise<CapturedImage | null>;
  /**
   * The text of one window, named by id or defaulting to the foreground one.
   *
   * Takes the exclusion list because the refusal has to happen before the read, not after
   * it: a read that runs and is then discarded has already pulled the window's contents
   * into this process.
   */
  readWindowText(
    params: ReadWindowTextParams,
    exclusions: CaptureExclusions,
  ): Promise<ReadTextAnswer>;
  /**
   * A screenshot of one listed window, in front or behind others. Takes the exclusion list
   * for the same reason as `readWindowText`: the refusal comes before any pixel is read.
   */
  lookAtWindow(
    params: { windowId: string; maxLongSide: number },
    exclusions: CaptureExclusions,
  ): Promise<LookAtWindowAnswer>;
}

/**
 * Throws on an unsupported platform rather than returning a stub: a host that silently
 * perceives nothing looks like a broken brain, not a missing adapter.
 */
export function createPlatform(platform: NodeJS.Platform = process.platform): Platform {
  if (platform === 'win32') return new Win32Platform();
  throw new Error(`Tagalong has no platform adapter for '${platform}'. It runs on Windows only.`);
}

export type { Win32Platform };
/**
 * The window inventory, and whether producing it actually worked.
 *
 * The failure is carried rather than folded into an empty array because the two are
 * indistinguishable otherwise — which is how an enumeration that never worked at all
 * shipped through a task, a review and a green CI run.
 */
export interface WindowInventory {
  windows: WindowEntry[];
  /** Every screen in composite order, so the list can be grouped as "Screen 1", "Screen 2". */
  displays?: ScreenInfo[];
  failure?: WindowEnumerationFailure;
}

export type { CapturedDisplay, DisplayInfo, DisplaysCapture } from './displays';
export type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
export type { TextLayerProvider } from './text-layer';
