import { randomUUID } from 'node:crypto';
import { findCaptureBlock } from '@tagalong/core';
import type { CaptureBlock } from '@tagalong/core';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions, ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import type { ActiveWindowInfo, Platform } from './platform/index';

/** What the desktop host tells the engine it can perceive. */
export const DESKTOP_CAPABILITIES = [
  'selection',
  'activeWindow',
  'clipboard',
  'screenshot',
  // Phase 2B. `textLayer` is deliberately absent until the text layer lands: advertising
  // a capability the host cannot honour makes the engine call a method that fails, which
  // reads to the user as a broken pet rather than a missing feature.
  'displays',
] as const;

/**
 * Long side of a captured screenshot, in pixels.
 *
 * 1568 is where the vision models stop gaining detail and start charging for it — beyond
 * it the image is downscaled on the far side anyway, so the extra pixels only cost upload
 * time and tokens.
 */
export const MAX_SCREENSHOT_LONG_SIDE = 1568;

/** What a capture produced, and the rule that refused it if one did. */
export interface CaptureOptions {
  /** Screenshots are opt-in per capture: they cost ~1,500 extra input tokens each. */
  screenshot: boolean;
  exclusions: CaptureExclusions;
}

export interface AskCapture {
  snapshot: ContextSnapshot;
  blocked: CaptureBlock | null;
}

export interface PatchCapture {
  patch: ContextSnapshotPatch;
  blocked: CaptureBlock | null;
}

/**
 * Perception is best effort.
 *
 * A clipboard the OS briefly locked, or a window that closed between the hotkey and the
 * read, must not cost the user their whole ask — the pet can still answer with less.
 */
async function attempt<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.warn(`[context] could not read ${what}:`, error);
    return null;
  }
}

/** The snapshot's `app` field, or nothing when the host could not name the window. */
function appOf(window: ActiveWindowInfo | null): { app?: ContextSnapshot['app'] } {
  if (window === null) return {};
  return { app: { name: window.appName, ...(window.title ? { windowTitle: window.title } : {}) } };
}

/**
 * Takes the picture — unless the focused window is one the user excluded.
 *
 * The check runs *before* the capture, never after: a screenshot of a password manager
 * that is discarded a moment later has still been decoded into this process's memory, and
 * the promise the exclusion list makes is that those pixels are never read at all.
 */
async function captureScreenshot(
  platform: Platform,
  exclusions: CaptureExclusions,
  window: ActiveWindowInfo | null,
): Promise<{ screenshot?: ContextSnapshot['screenshot']; blocked: CaptureBlock | null }> {
  const blocked = findCaptureBlock(
    window === null ? undefined : { processName: window.appName, title: window.title },
    exclusions,
  );
  if (blocked !== null) return { blocked };

  const image = await attempt('the screen', () =>
    platform.captureActiveWindowImage(MAX_SCREENSHOT_LONG_SIDE),
  );
  if (image === null) return { blocked: null };

  return {
    screenshot: {
      mime: 'image/png',
      base64: image.base64,
      width: image.width,
      height: image.height,
    },
    blocked: null,
  };
}

/** Everything this host can see, packaged as the snapshot that rides along with an ask. */
export async function captureAskSnapshot(
  platform: Platform,
  options: CaptureOptions,
): Promise<AskCapture> {
  const [selection, window] = await Promise.all([
    attempt('the selection', () => platform.captureSelection()),
    attempt('the active window', () => platform.getActiveWindow()),
  ]);

  const shot = options.screenshot
    ? await captureScreenshot(platform, options.exclusions, window)
    : { blocked: null };

  return {
    snapshot: ContextSnapshot.parse({
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      host: 'desktop',
      ...(selection !== null && selection.length > 0 ? { selection } : {}),
      ...appOf(window),
      ...('screenshot' in shot && shot.screenshot ? { screenshot: shot.screenshot } : {}),
    }),
    blocked: shot.blocked,
  };
}

/**
 * Answers the engine's perception.capture with just the targets it named. Page text only
 * ever comes from the extension, so it is silently absent here.
 */
export async function capturePatch(
  platform: Platform,
  what: readonly PerceptionTarget[],
  options: { exclusions: CaptureExclusions },
): Promise<PatchCapture> {
  const patch: ContextSnapshotPatch = {};
  let blocked: CaptureBlock | null = null;

  if (what.includes('selection')) {
    const selection = await attempt('the selection', () => platform.captureSelection());
    if (selection !== null && selection.length > 0) patch.selection = selection;
  }
  if (what.includes('clipboard')) {
    const clipboard = await attempt('the clipboard', () => platform.readClipboard());
    if (clipboard !== null) patch.clipboard = clipboard;
  }

  // Read once and share it: the exclusion check and the `app` field want the same window,
  // and asking twice could see two different foreground windows.
  const needsWindow = what.includes('activeWindow') || what.includes('screenshot');
  const window = needsWindow
    ? await attempt('the active window', () => platform.getActiveWindow())
    : null;

  if (what.includes('windows')) {
    const windows = await attempt('the open windows', () =>
      platform.listWindows(options.exclusions),
    );
    // An empty list means the enumeration failed or found nothing it could classify, not
    // that the desktop is empty. Omitting it keeps the pet from reasoning off a lie.
    if (windows !== null && windows.length > 0) patch.windows = windows;
  }

  if (what.includes('activeWindow')) Object.assign(patch, appOf(window));
  if (what.includes('screenshot')) {
    const shot = await captureScreenshot(platform, options.exclusions, window);
    if (shot.screenshot) patch.screenshot = shot.screenshot;
    blocked = shot.blocked;
  }

  return { patch, blocked };
}
