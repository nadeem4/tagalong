import type { CaptureExclusions } from '@tagalong/protocol';

import type { DisplaysCapture } from './displays';
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
export type { CapturedDisplay, DisplayInfo, DisplaysCapture } from './displays';
