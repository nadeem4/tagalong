/**
 * The window inventory: applies exclusions to the host's window list (buildInventory) and
 * renders it for the prompt (renderInventory). Shared by core and the desktop host.
 */
import type { CaptureExclusions, ScreenInfo, WindowEntry } from '@tagalong/protocol';

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

/**
 * The readable-character count as it appears on a line.
 *
 * Rounded above a thousand because the pet is deciding whether a read is worth a tool
 * call, and no decision turns on the difference between 5,399 and 5,400. Rounding also
 * signals what the number is: an indication, not a promise about what comes back.
 */
function countMark(chars: number): string {
  return chars < 1_000 ? `t${chars}` : `t${Math.round(chars / 1_000)}k`;
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
 *
 * Given the host's screens, windows are grouped under "Screen 1", "Screen 2" in that order,
 * then minimized ones together. That grouping is the whole answer to "what do you see?",
 * so the pet can give it without a screenshot.
 */
export function renderInventory(
  windows: readonly WindowEntry[],
  displays?: readonly ScreenInfo[],
): string {
  if (windows.length === 0) return 'No windows are open that Tagalong can see.';

  const header = [
    `Open windows (${windows.length}), top first. fg foreground, bg background, min minimized, ` +
      `t900 about 900 readable characters and t5k about 5,000.`,
    'Read one with read_window_text(id); no window text is included here.',
    'A browser window exposes only its active tab; other tabs need the browser extension.',
  ];

  const minimized = windows.filter((window) => window.state === 'minimized');
  const shown = windows.filter((window) => window.state !== 'minimized');
  const groups: string[] = [];

  if (displays === undefined || displays.length === 0) {
    // No screen list to number against. The raw display id is not printed: it is a
    // ten-digit Electron number the pet would repeat to the user as "screen 2528732444".
    groups.push(...shown.map(renderLine));
  } else {
    // Numbered by position, the way the composite labels its corners, so "screen 2" means
    // the same screen here, in the picture and to the person reading the answer.
    header.push(
      `${displays.length} screen${displays.length === 1 ? '' : 's'}, numbered as on the composite: ` +
        displays.map((display, index) => `${index + 1} ${screenSize(display)}`).join(', ') +
        '.',
    );
    displays.forEach((display, index) => {
      const on = shown.filter((window) => window.displayId === display.id);
      groups.push(`Screen ${index + 1}:${on.length === 0 ? ' nothing open' : ''}`);
      groups.push(...on.map(renderLine));
    });
    const known = new Set(displays.map((display) => display.id));
    const elsewhere = shown.filter(
      (window) => window.displayId === undefined || !known.has(window.displayId),
    );
    if (elsewhere.length > 0) groups.push('Not on a screen:', ...elsewhere.map(renderLine));
  }

  if (minimized.length > 0) groups.push('Minimized:', ...minimized.map(renderLine));

  return [...header, ...groups].join('\n');
}

function screenSize(display: ScreenInfo): string {
  const size = `${display.bounds.width}x${display.bounds.height}`;
  return display.primary ? `primary ${size}` : size;
}

function renderLine(window: WindowEntry): string {
  if (window.blocked !== undefined) {
    return `${window.id} ${window.processName} blocked by ${window.blocked.entry}`;
  }

  const browser = window.browser ? ' browser' : '';
  const name = window.processName.replace(/\.exe$/i, '');
  // Absent stays absent rather than rendering as t0: the pet would read "nobody looked"
  // as "there is nothing there" and skip a window worth reading.
  const chars = window.textChars === undefined ? '' : ` ${countMark(window.textChars)}`;
  return `${window.id} ${name} ${STATE_CODE[window.state]} "${shorten(window.title)}"${chars}${browser}`;
}
