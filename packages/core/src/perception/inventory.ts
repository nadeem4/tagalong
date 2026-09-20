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

/**
 * How much of a window title survives into the prompt.
 *
 * Short because the budget is per-desktop, not per-window: twelve windows share it. Real
 * titles are usually front-loaded — the document name comes before the application name —
 * so the first 28 characters carry most of what identifies a window.
 */
const MAX_TITLE_CHARS = 28;

/** Spelled out once in the header rather than on every line, which costs twelve times more. */
const STATE_CODE: Record<ObservedWindow['state'], string> = {
  foreground: 'fg',
  background: 'bg',
  minimized: 'min',
};

export function isBrowserProcess(processName: string): boolean {
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
    };
  });
}

function shorten(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_TITLE_CHARS ? flat : `${flat.slice(0, MAX_TITLE_CHARS - 1)}…`;
}

/**
 * Renders the inventory as the lines that go into the prompt.
 *
 * Deliberately terse. This is attached to every full-view capture, so it is paid for on
 * every ask whether the pet uses it or not; the acceptance budget is under 300 tokens for
 * a twelve-window desktop. Titles are truncated because Windows allows around 260
 * characters and three such titles would spend the whole budget on three windows.
 *
 * The per-window text is deliberately absent. The pet reads this, picks one window, and
 * spends a tool call on that one.
 */
export function renderInventory(windows: readonly WindowEntry[]): string {
  if (windows.length === 0) return 'No windows are open that Tagalong can see.';

  const lines = windows.map((window) => {
    if (window.blocked !== undefined) {
      return `${window.id} ${window.processName} blocked by ${window.blocked.entry}`;
    }

    const where = window.displayId === undefined ? '' : ` d${window.displayId}`;
    const browser = window.browser ? ' browser' : '';
    const name = window.processName.replace(/\.exe$/i, '');
    return `${window.id} ${name}${where} ${STATE_CODE[window.state]} "${shorten(window.title)}"${browser}`;
  });

  return [
    `Open windows (${windows.length}). fg foreground, bg background, min minimized, d1 display 1.`,
    'Read one with read_window_text(id); no window text is included here.',
    'A browser window exposes only its active tab; other tabs need the browser extension.',
    ...lines,
  ].join('\n');
}
