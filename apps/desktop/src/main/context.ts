import { randomUUID } from 'node:crypto';
import { findCaptureBlock } from '@tagalong/core';
import type { CaptureBlock } from '@tagalong/core';
import { ContextSnapshot } from '@tagalong/protocol';
import type { CaptureExclusions, ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import type { ActiveWindowInfo, DisplaysCapture, Platform } from './platform/index';

/** What the desktop host tells the engine it can perceive. */
export const DESKTOP_CAPABILITIES = [
  'selection',
  'activeWindow',
  'clipboard',
  'screenshot',
  // Phase 2B.
  'displays',
  // The text layer reads any window by id, including ones behind others and minimized
  // ones. Advertised only now that `perception.readText` is answered: a capability the
  // host cannot honour makes the engine call a method that fails, which reads to the user
  // as a broken pet rather than a missing feature.
  'textLayer',
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
  /**
   * Phase 2B: every display, the composite, and the window inventory.
   *
   * Opt-in per capture for the same reason as the screenshot, and more so. Enumerating
   * windows costs seconds of walking accessibility trees, and doing it on the cheap ask
   * is what would make the fast path stop feeling fast.
   */
  fullView?: boolean;
  exclusions: CaptureExclusions;
}

export interface AskCapture {
  snapshot: ContextSnapshot;
  blocked: CaptureBlock | null;
}

export interface PatchCapture {
  patch: ContextSnapshotPatch;
  blocked: CaptureBlock | null;
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
 * The full-view half of a capture: every display plus everything that is open.
 *
 * Both reads are best effort, like every other perception. A capturer that throws must
 * not cost the user the selection they highlighted before pressing the key.
 */
async function captureFullView(
  platform: Platform,
  exclusions: CaptureExclusions,
  options: { windows?: boolean } = {},
): Promise<{ patch: ContextSnapshotPatch; blocked: CaptureBlock | null }> {
  const wantsWindows = options.windows ?? true;
  const [capture, inventory] = await Promise.all([
    attempt('the displays', () => platform.captureDisplays(MAX_SCREENSHOT_LONG_SIDE, exclusions)),
    wantsWindows ? attempt('the open windows', () => platform.listWindows(exclusions)) : null,
  ]);

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
  // An empty or failed enumeration stays out of the snapshot: a pet told the desktop has
  // no windows on it reasons from that as though it had been observed.
  if (inventory !== null && inventory.failure === undefined && inventory.windows.length > 0) {
    patch.windows = inventory.windows;
  }

  // The notice says why the pet cannot see, and the screen the user is on is the one
  // whose refusal they will notice. A blanked display elsewhere is already named in the
  // context text and in the composite.
  const focusedRefusal = capture?.displays.find((display) => display.focused)?.blocked ?? null;
  return { patch, blocked: focusedRefusal };
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

  const full = options.fullView
    ? await captureFullView(platform, options.exclusions)
    : { patch: {}, blocked: null };

  return {
    snapshot: ContextSnapshot.parse({
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      host: 'desktop',
      ...(selection !== null && selection.length > 0 ? { selection } : {}),
      ...appOf(window),
      ...('screenshot' in shot && shot.screenshot ? { screenshot: shot.screenshot } : {}),
      ...full.patch,
    }),
    blocked: shot.blocked ?? full.blocked,
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

  // Read once and share it: the exclusion check and the `app` field want the same window,
  // and asking twice could see two different foreground windows.
  const needsWindow = what.includes('activeWindow') || what.includes('screenshot');
  const window = needsWindow
    ? await attempt('the active window', () => platform.getActiveWindow())
    : null;

  if (what.includes('windows')) {
    const inventory = await attempt('the open windows', () =>
      platform.listWindows(options.exclusions),
    );
    // The inventory is still omitted from the snapshot when it is empty — a pet told the
    // desktop has no windows on it will reason from that. What changed is that the
    // omission is no longer silent: an empty list is a failure, and staying quiet about
    // it is what let a completely broken enumeration ship unnoticed.
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
    const full = await captureFullView(platform, options.exclusions, { windows: false });
    if (full.patch.displays === undefined) {
      // The host advertises the `displays` capability, so a silent nothing here is the
      // engine calling a method it was told would work and getting an empty answer.
      warnings.push('the displays could not be captured');
    }
    Object.assign(patch, full.patch);
    blocked = full.blocked;
  }

  if (what.includes('activeWindow')) Object.assign(patch, appOf(window));
  if (what.includes('screenshot')) {
    const shot = await captureScreenshot(platform, options.exclusions, window);
    if (shot.screenshot) patch.screenshot = shot.screenshot;
    blocked = shot.blocked ?? blocked;
  }

  return { patch, blocked, warnings };
}
