/**
 * What the desktop can see, packaged for the engine: the ask's snapshot (selection and the window
 * in focus) and the answer to perception.capture. Contains DESKTOP_CAPABILITIES,
 * captureAskSnapshot, capturePatch and answerCapture.
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { findCaptureBlock, normalizeProcessName } from '@tagalong/core';
import type { CaptureBlock } from '@tagalong/core';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions, ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import type { ActiveWindowInfo, DisplaysCapture, Platform } from './platform/index';
import { SightPausedError, isSightPaused } from './platform/sight-gate';

/** What the desktop host tells the engine it can perceive. */
export const DESKTOP_CAPABILITIES = [
  'selection',
  'activeWindow',
  'clipboard',
  'screenshot',
  'displays',
  // The text layer reads any window by id, including ones behind others and minimized
  // ones. Advertised only now that `perception.readText` is answered: a capability the
  // host cannot honour makes the engine call a method that fails, which reads to the user
  // as a broken pet rather than a missing feature.
  'textLayer',
  // Advertised whether or not rolling memory is on: recall then answers that it
  // is not recording, which the pet can repeat, and diff works regardless for watches.
  'recall',
] as const;

/**
 * Long side of a captured screenshot, in pixels.
 *
 * 1568 is where the vision models stop gaining detail and start charging for it — beyond
 * it the image is downscaled on the far side anyway, so the extra pixels only cost upload
 * time and tokens.
 */
export const MAX_SCREENSHOT_LONG_SIDE = 1568;

/** What the ask's capture produced, and the rule that refused it if one did. */
export interface AskCapture {
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

export interface PatchCapture {
  patch: ContextSnapshotPatch;
  blocked: CaptureBlock | null;
  /** True when sight is paused. Distinct from `blocked`, and from an empty patch. */
  paused: boolean;
  /**
   * Things that went wrong quietly enough that nothing else would have said so.
   *
   * Perception is best effort, and most of what it cannot read is genuinely optional. An
   * enumeration that returns nothing is different: a running desktop always has at least
   * one top-level window, since Tagalong's own is one, so nothing is not a thin answer
   * but a broken one. Carrying it here is what lets the host surface it instead of the
   * failure looking exactly like a quiet desktop.
   */
  warnings: string[];
}

/** Why an empty window list is a failure rather than an answer. */
const ENUMERATION_COMPLAINTS: Record<string, string> = {
  'no-output': 'the window list helper returned nothing at all',
  unparseable: 'the window list helper returned output that could not be read',
  'no-windows': 'the window list enumerated no windows, which cannot happen on a running desktop',
};

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
 * prompt, the conversation or a brief. It carries `blocked` instead, so the engine still refuses
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
 * Takes the picture — unless the focused window is one the user excluded.
 *
 * The check runs *before* the capture, never after: a screenshot of a password manager
 * that is discarded a moment later has still been decoded into this process's memory, and
 * the promise the exclusion list makes is that those pixels are never read at all.
 */
async function captureScreenshot(
  platform: Platform,
  exclusions: CaptureExclusions,
  window: SeenWindow | null,
): Promise<{ screenshot?: ContextSnapshot['screenshot']; blocked: CaptureBlock | null }> {
  const blocked = findCaptureBlock(
    window === null ? undefined : { processName: window.appName, title: window.title },
    exclusions,
  );
  if (blocked !== null) return { blocked };

  const listedId = window?.listedId;
  const image =
    listedId === undefined
      ? await attempt('the screen', () =>
          platform.captureActiveWindowImage(MAX_SCREENSHOT_LONG_SIDE, exclusions),
        )
      : ((
          await attempt('the window', () =>
            platform.lookAtWindow(
              { windowId: listedId, maxLongSide: MAX_SCREENSHOT_LONG_SIDE },
              exclusions,
            ),
          )
        )?.image ?? null);
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

/**
 * Turns a platform display capture into the snapshot's shape.
 *
 * `null` and absent are different on the way in and the same on the way out: the platform
 * uses null for "no picture", the protocol omits the field. A null that survived would be
 * an image block with no image, which providers reject.
 */
function toSnapshotDisplays(capture: DisplaysCapture): ContextSnapshot['displays'] {
  return capture.displays.map((display) => ({
    id: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    primary: display.primary,
    focused: display.focused,
    ...(display.blocked === null ? {} : { blocked: display.blocked }),
    ...(display.image === null
      ? {}
      : {
          image: {
            mime: 'image/png' as const,
            base64: display.image.base64,
            width: display.image.width,
            height: display.image.height,
          },
        }),
  }));
}

/**
 * Every display and the composite, for the displays target.
 *
 * Best effort, like every other perception: a capturer that throws must not cost the
 * engine the other targets it asked for.
 */
async function captureFullView(
  platform: Platform,
  exclusions: CaptureExclusions,
): Promise<{ patch: ContextSnapshotPatch; blocked: CaptureBlock | null }> {
  const capture = await attempt('the displays', () =>
    platform.captureDisplays(MAX_SCREENSHOT_LONG_SIDE, exclusions),
  );

  const patch: ContextSnapshotPatch = {};
  if (capture !== null) {
    patch.displays = toSnapshotDisplays(capture);
    if (capture.composite !== null) {
      patch.composite = {
        mime: 'image/png',
        base64: capture.composite.base64,
        width: capture.composite.width,
        height: capture.composite.height,
      };
    }
  }
  // The notice says why the pet cannot see, and the screen the user is on is the one
  // whose refusal they will notice. A blanked display elsewhere is already named in the
  // context text and in the composite.
  const focusedRefusal = capture?.displays.find((display) => display.focused)?.blocked ?? null;
  return { patch, blocked: focusedRefusal };
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
 * Answers the engine's perception.capture with just the targets it named. Page text only
 * ever comes from the extension, so it is silently absent here.
 */
export async function capturePatch(
  platform: Platform,
  what: readonly PerceptionTarget[],
  options: { exclusions: CaptureExclusions },
): Promise<PatchCapture> {
  const patch: ContextSnapshotPatch = {};
  const warnings: string[] = [];
  let blocked: CaptureBlock | null = null;

  if (what.includes('selection')) {
    const selection = await attempt('the selection', () => platform.captureSelection());
    if (selection !== null && selection.length > 0) patch.selection = selection;
  }
  if (what.includes('clipboard')) {
    const clipboard = await attempt('the clipboard', () => platform.readClipboard());
    if (clipboard !== null) patch.clipboard = clipboard;
  }

  // Everything from here reads the screen, so it sits behind one pause check. A refused
  // capture must not also report the warnings a failed one would: training the user to
  // ignore a warning they caused on purpose is how the real ones stop being read.
  const gated = await unlessPaused(async () => {
    // Read once and share it: the exclusion check and the `app` field want the same window,
    // and asking twice could see two different foreground windows.
    const needsWindow = what.includes('activeWindow') || what.includes('screenshot');
    const window = needsWindow ? await windowInFocus(platform, options.exclusions) : null;

    if (what.includes('windows')) {
      const inventory = await attempt('the open windows', () =>
        platform.listWindows(options.exclusions),
      );
      // An empty inventory still stays out of the snapshot: a pet told the desktop has no
      // windows will reason from that. It is reported as a failure instead, so a broken
      // enumeration is never silent.
      if (inventory === null) {
        warnings.push('the window list could not be read at all');
      } else if (inventory.failure !== undefined) {
        const complaint = ENUMERATION_COMPLAINTS[inventory.failure] ?? 'the window list failed';
        warnings.push(complaint);
        console.warn(`[context] ${complaint}`);
      } else if (inventory.windows.length > 0) {
        patch.windows = inventory.windows;
      }
    }

    if (what.includes('displays')) {
      const full = await captureFullView(platform, options.exclusions);
      if (full.patch.displays === undefined) {
        // The host advertises the `displays` capability, so a silent nothing here is the
        // engine calling a method it was told would work and getting an empty answer.
        warnings.push('the displays could not be captured');
      }
      Object.assign(patch, full.patch);
      blocked = full.blocked;
    }

    if (what.includes('activeWindow')) Object.assign(patch, appOf(window, options.exclusions));
    if (what.includes('screenshot')) {
      const shot = await captureScreenshot(platform, options.exclusions, window);
      if (shot.screenshot) patch.screenshot = shot.screenshot;
      blocked = shot.blocked ?? blocked;
    }
    return null;
  });

  return { patch, blocked, warnings, paused: gated.paused };
}

/**
 * What perception.capture answers. A paused look at the screen or the displays surfaces the
 * pause, as every other screen tool does, instead of an empty answer the pet would read as
 * a capture that found nothing. Ungated reads (the selection, the clipboard) still answer.
 */
export function answerCapture(
  what: readonly PerceptionTarget[],
  capture: PatchCapture,
): ContextSnapshotPatch {
  const looked = what.find((target) => target === 'screenshot' || target === 'displays');
  if (capture.paused && looked !== undefined) throw new SightPausedError(looked);
  return capture.patch;
}
