/**
 * The Platform interface: everything the brain can ask this machine to perceive. Contains
 * Platform, its shapes (WindowBounds, ActiveWindowInfo, CapturedImage, WindowInventory) and
 * createPlatform. Windows is the only adapter.
 */

import type { CaptureExclusions } from '../../shared/settings';
import type { ScreenInfo, WindowEntry } from '@tagalong/ui/shapes';

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
  /**
   * Every top-level window, with no window text in it.
   *
   * Takes the exclusion list so one window is
   * refused while the rest are returned, so the decision belongs inside the enumeration.
   * Entries come back already classified, so nothing downstream has to remember to check.
   */
  listWindows(
    exclusions: CaptureExclusions,
    /** `countText: false` skips the text count, for the focus watch, listening guard and list_windows: titles are all they need. */
    options?: { countText?: boolean },
  ): Promise<WindowInventory>;
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

/**
 * The window inventory, and whether producing it actually worked.
 *
 * The failure is carried rather than folded into an empty array because the two are
 * indistinguishable otherwise — which is how an enumeration that never worked at all
 * shipped through a task, a review and a green CI run.
 */
export interface WindowInventory {
  windows: WindowEntry[];
  /** Every screen in display order, so the list can be grouped as "Screen 1", "Screen 2". */
  displays?: ScreenInfo[];
  failure?: WindowEnumerationFailure;
}
