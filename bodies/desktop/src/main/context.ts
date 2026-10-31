/**
 * What the desktop can see, packaged for the brain: the ask's snapshot (selection and the window
 * in focus) and the voice path's window-only snapshot. Contains captureAskSnapshot and
 * captureActiveWindow.
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { findCaptureBlock, normalizeProcessName } from './platform/exclusions';
import { ContextSnapshot } from '@tagalong/ui/shapes';
import type { CaptureBlock } from '@tagalong/ui/shapes';
import type { CaptureExclusions } from '../shared/settings';
import type { ActiveWindowInfo, Platform } from './platform/index';
import { isSightPaused } from './platform/sight-gate';

/**
 * Long side of a captured screenshot, in pixels.
 *
 * 1568 is where the vision models stop gaining detail and start charging for it — beyond
 * it the image is downscaled on the far side anyway, so the extra pixels only cost upload
 * time and tokens.
 */
export const MAX_SCREENSHOT_LONG_SIDE = 1568;

/** What the ask's capture produced, and the rule that refused it if one did. */
interface AskCapture {
  snapshot: ContextSnapshot;
  blocked: CaptureBlock | null;
  /**
   * True when the user has sight turned off, which is not the same fact as `blocked`.
   *
   * "You turned sight off" and "this app is on your exclusion list" are different
   * sentences and the user fixes them differently, so the two never collapse into one
   * flag. Both being false with an empty snapshot means the read simply found nothing.
   */
  paused: boolean;
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
    // A pause is a decision the user made, not a failure, and it is the one thing here
    // that must not be swallowed. Treating it as best effort would turn "you turned sight
    // off" into an empty capture indistinguishable from a quiet screen, the exact shape a
    // broken read takes.
    if (isSightPaused(error)) throw error;
    console.warn(`[context] could not read ${what}:`, error);
    return null;
  }
}

/**
 * Runs a read that may be refused by the pause, reporting which happened.
 *
 * The pause is caught once per capture path rather than per read, so a paused capture is
 * one fact about the whole attempt instead of a flag each target sets independently.
 */
async function unlessPaused<T>(
  read: () => Promise<T>,
): Promise<{ value: T | null; paused: boolean }> {
  try {
    return { value: await read(), paused: false };
  } catch (error) {
    if (isSightPaused(error)) return { value: null, paused: true };
    throw error;
  }
}

/** A window as far as a capture needs it: what it is, and where it is when known. */
type SeenWindow = Pick<ActiveWindowInfo, 'appName' | 'title'> & {
  /** Present when the window came from the list rather than the foreground. */
  listedId?: string;
};

/** Whether a window belongs to Tagalong itself: its bubble, its pet, its settings. */
function isOwnWindow(appName: string): boolean {
  return normalizeProcessName(appName) === normalizeProcessName(basename(process.execPath));
}

/**
 * The window the person means by "my screen".
 *
 * Usually the one in front. But while they type to Scout, Scout's own bubble is in front,
 * and a screenshot of that tells Scout only about itself. Then it is the topmost window
 * that is not Tagalong's and not minimized, from the list (which comes top first).
 */
async function windowInFocus(
  platform: Platform,
  exclusions: CaptureExclusions,
): Promise<SeenWindow | null> {
  const active = await attempt('the active window', () => platform.getActiveWindow());
  if (active === null || !isOwnWindow(active.appName)) return active;
  const inventory = await attempt('the open windows', () => platform.listWindows(exclusions));
  const next = inventory?.windows.find(
    (window) => window.state !== 'minimized' && !isOwnWindow(window.processName),
  );
  if (next === undefined) return null;
  return { appName: next.processName, title: next.title, listedId: next.id };
}

/**
 * The snapshot's `app` field, or nothing when the host could not name the window. A blocked
 * window (a blind spot or an exclusion) keeps only its app name: its title never reaches the
 * prompt, the conversation or a brief. It carries `blocked` instead, so the brain still refuses
 * on a title rule it can no longer match.
 */
function appOf(
  window: SeenWindow | null,
  exclusions: CaptureExclusions,
): { app?: ContextSnapshot['app'] } {
  if (window === null) return {};
  const blocked = findCaptureBlock(
    { processName: window.appName, title: window.title },
    exclusions,
  );
  if (blocked !== null) return { app: { name: window.appName, blocked } };
  return { app: { name: window.appName, ...(window.title ? { windowTitle: window.title } : {}) } };
}

/**
 * The snapshot that rides along with an ask: the selection and the window in focus. No
 * picture, no displays and no window list: those cost tokens and seconds, and Scout takes
 * them itself, through a tool, when a question needs them.
 */
export async function captureAskSnapshot(
  platform: Platform,
  options: { exclusions: CaptureExclusions },
): Promise<AskCapture> {
  // The window read sits behind the pause check: a paused capture names no app.
  const focused = await unlessPaused(() =>
    attempt('the active window', () => platform.getActiveWindow()),
  );
  // A window Scout must not look at (a password manager, a .env file) gives up nothing,
  // not even a highlight: Ctrl+C is never pressed there.
  const window = focused.value ?? null;
  const selectionBlock = findCaptureBlock(
    window === null ? undefined : { processName: window.appName, title: window.title },
    options.exclusions,
  );
  const selection =
    selectionBlock === null
      ? await attempt('the selection', () => platform.captureSelection())
      : null;

  return {
    snapshot: ContextSnapshot.parse({
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      host: 'desktop',
      ...(selection !== null && selection.length > 0 ? { selection } : {}),
      ...appOf(window, options.exclusions),
    }),
    blocked: selectionBlock,
    paused: focused.paused,
  };
}

/**
 * The window in focus alone, for the voice path: no selection, so Ctrl+C is never pressed
 * while the person is talking. A blocked or paused read gives the app name or nothing.
 */
export async function captureActiveWindow(
  platform: Platform,
  options: { exclusions: CaptureExclusions },
): Promise<{
  patch: { app?: ContextSnapshot['app'] };
  blocked: CaptureBlock | null;
  paused: boolean;
}> {
  const focused = await unlessPaused(() => windowInFocus(platform, options.exclusions));
  const window = focused.value ?? null;
  const blocked = findCaptureBlock(
    window === null ? undefined : { processName: window.appName, title: window.title },
    options.exclusions,
  );
  return { patch: appOf(window, options.exclusions), blocked, paused: focused.paused };
}
