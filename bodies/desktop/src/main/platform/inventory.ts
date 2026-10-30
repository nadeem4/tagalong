/**
 * The window inventory: applies exclusions to the host's window list. Contains
 * buildInventory and ObservedWindow.
 */
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';

import { findCaptureBlock, normalizeProcessName } from './exclusions';

/**
 * One window as the host found it, before any policy is applied.
 *
 * The host does the enumerating and the display mapping, because both need the OS. What
 * a window *means* — whether it may be read, whether its tabs are reachable, how it reads
 * in a prompt — is decided here, where it can be tested without a desktop.
 */
export interface ObservedWindow {
  /** Opaque and host-assigned. Only the host that issued it can resolve it. */
  readonly id: string;
  readonly processName: string;
  readonly title: string;
  readonly state: 'foreground' | 'background' | 'minimized';
  /** Absent when the host could not place the window on a display. */
  readonly displayId?: number;
  /**
   * Readable characters the text layer found, when the host counted them.
   *
   * Absent and zero mean different things and are kept apart. Absent is "nobody looked",
   * which happens when the host has no text layer. Zero is "looked, found none", which is
   * worth telling the pet because it saves a tool call that would return nothing.
   */
  readonly textChars?: number;
  /** True when the window covers its whole screen. Absent when it does not, or nobody knows. */
  readonly fullScreen?: boolean;
}

/**
 * Chromium-based browsers, whose accessibility tree covers the active tab only.
 *
 * The list is of families rather than every skin: these are the engines whose text layer
 * behaves the same way. A browser not named here simply loses the hint in the prompt — the
 * pet still reads its active tab — so the cost of the list being incomplete is small, and
 * the cost of guessing by substring is not: `chromium-helper` is not a browser window.
 */
const BROWSER_PROCESSES = new Set([
  'chrome',
  'msedge',
  'brave',
  'vivaldi',
  'opera',
  'chromium',
  'firefox',
]);

function isBrowserProcess(processName: string): boolean {
  return BROWSER_PROCESSES.has(normalizeProcessName(processName));
}

/**
 * Turns what the host saw into the inventory that rides along with a capture.
 *
 * A blocked window keeps its process name and loses its title. The title is the leak: a
 * process name says a password manager is open, which the user can see anyway, while
 * "Chase — Transfer to savings" says most of what is inside the window the exclusion list
 * exists to protect.
 */
export function buildInventory(
  observed: readonly ObservedWindow[],
  exclusions: CaptureExclusions,
): WindowEntry[] {
  return observed.map((window) => {
    const blocked = findCaptureBlock(
      { processName: window.processName, title: window.title },
      exclusions,
    );

    return {
      id: window.id,
      processName: window.processName,
      title: blocked === null ? window.title : '',
      state: window.state,
      browser: isBrowserProcess(window.processName),
      ...(window.displayId === undefined ? {} : { displayId: window.displayId }),
      ...(blocked === null ? {} : { blocked }),
      ...(window.fullScreen === true ? { fullScreen: true } : {}),
      // The count goes the way of the title for a blocked window. Knowing a vault holds
      // 4,000 readable characters says more than nothing at all, and this is a window the
      // user asked Tagalong never to read.
      ...(blocked === null && window.textChars !== undefined
        ? { textChars: window.textChars }
        : {}),
    };
  });
}
