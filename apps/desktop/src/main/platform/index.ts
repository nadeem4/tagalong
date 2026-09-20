import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';

import type { DisplaysCapture } from './displays';
import type { RegionCaptureParams } from './region';
import type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
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

/**
 * Everything the engine can ask this machine to perceive.
 *
 * Phase 1 implements Windows only; darwin and linux arrive in Phase 7. The interface
 * exists now because the plan names those second and third implementations.
 */
export interface Platform {
  getActiveWindow(): Promise<ActiveWindowInfo | null>;
  captureSelection(): Promise<string | null>;
  readClipboard(): Promise<string>;
  /** Phase 2. */
  captureActiveWindowImage(maxLongSide: number): Promise<CapturedImage | null>;
  /**
   * Phase 2B: every display at once, plus a composite showing how they are arranged.
   *
   * Takes the exclusion list, unlike `captureActiveWindowImage`, where the caller checks
   * it and then either asks for a picture or does not. That works when a capture is one
   * image and the answer is yes or no. Here one display can be refused while the others
   * are returned, and the composite has to show the refusal in that display's slot, so
   * the decision has to be made inside the capture rather than above it.
   */
  captureDisplays(maxLongSide: number, exclusions: CaptureExclusions): Promise<DisplaysCapture>;
  /**
   * Phase 2B: every top-level window, with no window text in it.
   *
   * Takes the exclusion list for the same reason `captureDisplays` does — one window is
   * refused while the rest are returned, so the decision belongs inside the enumeration.
   * Entries come back already classified, so nothing downstream has to remember to check.
   */
  listWindows(exclusions: CaptureExclusions): Promise<WindowInventory>;
  /**
   * Phase 2B: a native-resolution crop of one display, for leaning in.
   *
   * Takes no exclusion list, unlike its neighbours. A crop is only ever reached through a
   * display the pet listed first, and that listing is where a blocked display is refused;
   * checking twice would let the two checks disagree.
   */
  captureRegion(params: RegionCaptureParams): Promise<CapturedImage | null>;
  /**
   * Phase 2B: the text of one window, named by id or defaulting to the foreground one.
   *
   * Takes the exclusion list because the refusal has to happen before the read, not after
   * it: a read that runs and is then discarded has already pulled the window's contents
   * into this process.
   */
  readWindowText(
    params: ReadWindowTextParams,
    exclusions: CaptureExclusions,
  ): Promise<ReadTextAnswer>;
}

/**
 * Throws on an unsupported platform rather than returning a stub: a host that silently
 * perceives nothing looks like a broken engine, not a missing adapter.
 */
export function createPlatform(platform: NodeJS.Platform = process.platform): Platform {
  if (platform === 'win32') return new Win32Platform();
  throw new Error(`Tagalong has no platform adapter for '${platform}' until Phase 7`);
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
  failure?: WindowEnumerationFailure;
}

export type { CapturedDisplay, DisplayInfo, DisplaysCapture } from './displays';
export type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
export type { TextLayerProvider } from './text-layer';
