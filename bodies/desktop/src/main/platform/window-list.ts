/**
 * Parses the window enumeration, places each window on its display and attaches text counts.
 * Contains parseWindowList, placeOnDisplays, attachTextCounts and handleOf.
 */

import { findCaptureBlock } from './exclusions';
import type { ObservedWindow } from './inventory';
import type { CaptureExclusions, ScreenInfo } from '@tagalong/protocol';

import type { WindowBounds } from './index';

/** One entry as the PowerShell helper prints it. */
export interface RawWindow {
  handle: number;
  processName: string;
  title: string | null;
  minimized: boolean;
  foreground: boolean;
  bounds: WindowBounds;
}

/**
 * The most windows the inventory will carry.
 *
 * A desktop with more than this has a runaway enumeration behind it, and the inventory
 * rides along with every capture — a thousand lines in a prompt is a bill, not a feature.
 * Sixty-four is far past any real session; the twelve-window desktop the budget is
 * measured against is typical.
 */
const MAX_WINDOWS = 64;

/** Bounds a window could actually be seen at. */
function onScreen(bounds: WindowBounds): boolean {
  // Windows parks a minimized window at roughly (-32000, -32000) with no size. Asking
  // which display that falls on gets an answer, and the answer is meaningless.
  return bounds.width > 0 && bounds.height > 0 && bounds.x > -32000 && bounds.y > -32000;
}

function isRawWindow(value: unknown): value is RawWindow {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RawWindow>;
  return (
    typeof candidate.handle === 'number' &&
    candidate.handle !== 0 &&
    typeof candidate.processName === 'string' &&
    candidate.processName.trim().length > 0 &&
    typeof candidate.bounds === 'object' &&
    candidate.bounds !== null
  );
}

/**
 * Why an enumeration produced nothing.
 *
 * Every one of these is a failure. They are kept apart because they point at different
 * causes: `no-output` means the helper never really ran, `unparseable` means something
 * else wrote to stdout, and `no-windows` means it ran and answered with an impossibility.
 */
export type WindowEnumerationFailure = 'no-output' | 'unparseable' | 'no-windows';

export interface WindowListOutcome {
  windows: EnumeratedWindow[];
  /** Absent when the enumeration actually worked. */
  failure?: WindowEnumerationFailure;
}

/**
 * Reads the helper's stdout into observed windows.
 *
 * Forgiving on purpose. This shares stdout with whatever PowerShell decides to print, the
 * helper returns partial output when it times out, and a window can close between being
 * enumerated and being described. None of that may cost the user their ask — a missing
 * inventory is a pet that knows less, while a thrown error is a pet that says nothing.
 */
export function parseWindowList(stdout: string): WindowListOutcome {
  const text = stdout.trim();
  // Zero bytes is the signature of a helper that failed without saying so: PowerShell
  // exits 0, prints nothing to either stream, and every caller downstream sees a desktop
  // with no windows on it. Naming it is the only thing that makes it visible.
  if (text.length === 0) return { windows: [], failure: 'no-output' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { windows: [], failure: 'unparseable' };
  }

  // ConvertTo-Json unwraps a one-element array into a bare object unless told otherwise.
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  const windows: EnumeratedWindow[] = entries
    .filter(isRawWindow)
    .slice(0, MAX_WINDOWS)
    .map((window) => ({
      id: `w-${window.handle}`,
      processName: window.processName.trim(),
      title: typeof window.title === 'string' ? window.title : '',
      // Minimized wins over foreground. Windows reports both during a minimize animation,
      // and minimized is the state the user cannot see, which is the one worth telling
      // the pet about.
      state: window.minimized ? 'minimized' : window.foreground ? 'foreground' : 'background',
      bounds: window.bounds,
    }));

  // A running desktop cannot legitimately have zero top-level windows — Tagalong's own
  // window is one of them. Zero means the enumeration failed, whether the helper printed
  // an empty list or printed entries that none of them survived validation.
  return windows.length === 0 ? { windows, failure: 'no-windows' } : { windows };
}

/** An observed window that still carries the bounds used to place it on a display. */
export interface EnumeratedWindow extends ObservedWindow {
  readonly bounds: WindowBounds;
}

export interface DisplayLookup {
  /**
   * Screen pixels to DIPs: Electron's `screen.screenToDipRect`, which knows each monitor's
   * scale. The helper reports physical pixels and Electron's displays are in DIPs; compared
   * raw, every maximized window on a 150 % display covered it and counted as full screen.
   */
  screenToDipRect(window: null, rect: WindowBounds): WindowBounds;
  /** Electron's Display carries its bounds; a lookup without them never marks full screen. */
  getDisplayMatching(bounds: WindowBounds): { id: number; bounds?: WindowBounds };
}

/** The window covers the whole display, taskbar included: a game, a film, a slideshow. */
function covers(window: WindowBounds, display: WindowBounds): boolean {
  return (
    window.x <= display.x &&
    window.y <= display.y &&
    window.x + window.width >= display.x + display.width &&
    window.y + window.height >= display.y + display.height
  );
}

/**
 * Resolves which display each window sits on.
 *
 * A window that cannot be placed is left unplaced rather than defaulted. Guessing display
 * 1 would blank display 1 whenever an excluded app was minimized — both wrong and, to
 * someone watching their screen go grey, alarming.
 */
export function placeOnDisplays(
  windows: readonly EnumeratedWindow[],
  screen: DisplayLookup,
): ObservedWindow[] {
  return windows.map(({ bounds, ...window }) => {
    if (!onScreen(bounds)) return window;
    try {
      const dip = screen.screenToDipRect(null, bounds);
      const display = screen.getDisplayMatching(dip);
      const fullScreen = display.bounds !== undefined && covers(dip, display.bounds);
      return { ...window, displayId: display.id, ...(fullScreen ? { fullScreen } : {}) };
    } catch {
      return window;
    }
  });
}

/**
 * Every screen, numbered by its place in `getAllDisplays()`.
 *
 * That is the order the composite labels 1, 2, 3, so the window list can say "screen 2"
 * and mean the screen the picture calls 2. Geometry only: listing windows never takes a
 * picture.
 */
export function screensOf(screen: {
  getAllDisplays(): Array<{ id: number; bounds: WindowBounds }>;
  getPrimaryDisplay(): { id: number };
}): ScreenInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(({ id, bounds }) => ({
    id,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    primary: id === primary,
  }));
}

/**
 * Recovers the window handle from an id this module minted.
 *
 * Ids reach the host from the model, which can invent one it never saw. Returning null
 * for anything unrecognised makes that a read that fails honestly, rather than a coerced
 * NaN interpolated into a script that then targets nothing.
 */
export function handleOf(id: string): number | null {
  const match = /^w-(\d+)$/.exec(id);
  if (match === null) return null;
  const handle = Number(match[1]);
  return Number.isSafeInteger(handle) ? handle : null;
}

/**
 * Which windows may have their readable characters counted.
 *
 * Counting means walking the accessibility tree, and walking an excluded window is
 * exactly what the exclusion list exists to prevent — the count is not the leak, the walk
 * that produces it is. Filtering here rather than discarding counts afterwards means an
 * excluded window's contents are never pulled into the helper process at all.
 *
 * Uses the same `findCaptureBlock` the inventory does, so there is one matcher and not
 * two that can drift apart.
 */
export function countableHandles(
  observed: readonly ObservedWindow[],
  exclusions: CaptureExclusions,
): number[] {
  const handles: number[] = [];
  for (const window of observed) {
    const blocked = findCaptureBlock(
      { processName: window.processName, title: window.title },
      exclusions,
    );
    if (blocked !== null) continue;
    const handle = handleOf(window.id);
    if (handle !== null) handles.push(handle);
  }
  return handles;
}

/**
 * Puts the counted characters back on the windows they belong to.
 *
 * A window with no count keeps none. Absent means nobody looked, which is different from
 * zero, and rendering absent as zero would have the pet skip a window worth reading.
 */
export function attachTextCounts(
  observed: readonly ObservedWindow[],
  counts: ReadonlyMap<number, number>,
): ObservedWindow[] {
  return observed.map((window) => {
    const handle = handleOf(window.id);
    const chars = handle === null ? undefined : counts.get(handle);
    return chars === undefined ? window : { ...window, textChars: chars };
  });
}
