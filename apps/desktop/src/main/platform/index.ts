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
