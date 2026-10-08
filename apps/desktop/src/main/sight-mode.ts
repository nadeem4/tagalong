import type { CaptureExclusions, Settings } from '@tagalong/protocol';
import { captureAskSnapshot } from './context';
import type { AskCapture } from './context';
import type { Platform } from './platform/index';
import type { RollingMemorySettings } from './awareness/rolling-memory';

/** The sight permission, as settings store it. */
export type SightMode = Settings['sight'];

/** What a hotkey, the tray or a click on the pet asked the capture to include. */
export interface LookRequest {
  screenshot: boolean;
  fullView?: boolean;
}

/**
 * What a capture includes under the sight permission.
 *
 * `when-asked` is exactly the request. `always` makes every plain ask a look at the active
 * window, the same picture `Ctrl+Shift+S` takes. A see-everything capture is left alone: it
 * already carries every display, and adding the window shot would bill the same pixels twice.
 */
export function lookFor(sight: SightMode, request: LookRequest): LookRequest {
  if (sight !== 'always' || request.fullView === true) return request;
  return { ...request, screenshot: true };
}

/**
 * The rolling memory configuration under the sight permission: `always` keeps it running,
 * whatever the Awareness checkbox says, so a question can lean on the last few minutes.
 * The pause still stops it, because that check lives inside rolling memory itself.
 */
export function rollingMemoryFor(settings: Settings): RollingMemorySettings {
  return {
    enabled: settings.rollingMemory.enabled || settings.sight === 'always',
    minutes: settings.rollingMemory.minutes,
  };
}

/**
 * The capture behind an ask, under the sight permission. Exclusions and the pause win in
 * both modes: they are enforced inside `captureAskSnapshot` and the gated platform, below
 * the point this function changes anything.
 */
export function captureForAsk(
  platform: Platform,
  sight: SightMode,
  request: LookRequest,
  exclusions: CaptureExclusions,
): Promise<AskCapture> {
  const look = lookFor(sight, request);
  return captureAskSnapshot(platform, {
    screenshot: look.screenshot,
    ...(look.fullView === undefined ? {} : { fullView: look.fullView }),
    exclusions,
  });
}
