/**
 * Decides, from window titles alone, when one window is worth a closer look: the `settled`
 * and `trouble` check-ins.
 *
 * Nothing here reads a screen or calls a model. The host sends the window list every few
 * seconds; `track` follows every one, and `pick` (asked only when the check-in's gate is
 * open) names the rare window worth a look: one the person has settled on for half a
 * minute, or one whose title reads like something broke, never twice. Also holds the shared
 * call and full-screen rule (callOrFullScreenInFront) and the blind-spot check (blind).
 */
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import { findCaptureBlock, normalizeProcessName } from '../perception/exclusions';

/** How long the person stays on a window before it is worth a look. */
export const SETTLE_MS = 30_000;

/** Words a failing build, a crash or a stack trace put in a title. A cue to look, nothing more. */
const TROUBLE = /\b(error|errors|failed|failing|failure|exception|traceback|crashed)\b/i;

/** Call and meeting apps, by process: the pet never speaks over a call. */
const MEETING_PROCESSES = new Set(['teams', 'ms-teams', 'zoom']);
/** The same in a browser: a Google Meet tab, a Zoom meeting window. */
const MEETING_TITLE = /^Meet [-–] |Google Meet|Zoom Meeting/i;

export function looksLikeTrouble(title: string): boolean {
  return TROUBLE.test(title);
}

export function isMeeting(window: WindowEntry): boolean {
  return (
    MEETING_PROCESSES.has(normalizeProcessName(window.processName)) ||
    MEETING_TITLE.test(window.title)
  );
}

/**
 * The one call and full-screen rule: a call or a full-screen window in front, and Scout keeps
 * out of the way. It is the front window that counts, so a Teams window in front counts even
 * with no call, and a call behind another window does not. Check-ins, Always listening
 * and routine delivery all follow this one check.
 */
export function callOrFullScreenInFront(windows: readonly WindowEntry[]): boolean {
  const front = windows.find((window) => window.state === 'foreground');
  return front !== undefined && (front.fullScreen === true || isMeeting(front));
}

/** A window that has earned one look, and why. */
export interface Glance {
  window: WindowEntry;
  why: 'settled' | 'trouble';
}

/** The id and the title: a tab or a file switched in the same window is a new window. */
function keyOf(window: WindowEntry): string {
  return `${window.id}\n${window.title}`;
}

export class Lookout {
  readonly #clock: { now(): number };
  #focus: { key: string; since: number } | null = null;
  /** Every window already looked at this session, whether or not anything was said. */
  readonly #considered = new Set<string>();
  /** The last plain title in front: usually the editor an error belongs to. */
  #lastClean: string | null = null;

  constructor(clock: { now(): number }) {
    this.#clock = clock;
  }

  /** Every snapshot, gate open or not, so the thirty seconds are real ones. */
  track(windows: readonly WindowEntry[], exclusions: CaptureExclusions): void {
    const front = windows.find((window) => window.state === 'foreground');
    const frontKey = front === undefined ? null : keyOf(front);
    if (frontKey !== this.#focus?.key) {
      this.#focus = frontKey === null ? null : { key: frontKey, since: this.#clock.now() };
    }
    if (
      front !== undefined &&
      front.title.trim() !== '' &&
      !looksLikeTrouble(front.title) &&
      !blind(front, exclusions)
    ) {
      this.#lastClean = front.title;
    }
  }

  /** The one window to look at now, or null. A window returned here is never returned again. */
  pick(windows: readonly WindowEntry[], exclusions: CaptureExclusions): Glance | null {
    const now = this.#clock.now();
    const open = windows.filter(
      (window) =>
        window.state !== 'minimized' &&
        window.title.trim().length > 0 &&
        !this.#considered.has(keyOf(window)) &&
        !blind(window, exclusions),
    );

    const trouble = open.find((window) => looksLikeTrouble(window.title));
    if (trouble !== undefined) return this.#look(trouble, 'trouble');

    const settled = open.find(
      (window) =>
        window.state === 'foreground' &&
        this.#focus !== null &&
        now - this.#focus.since >= SETTLE_MS,
    );
    return settled === undefined ? null : this.#look(settled, 'settled');
  }

  /** The last plain, non-blind title in front, or null before there was one. */
  lastClean(): string | null {
    return this.#lastClean;
  }

  #look(window: WindowEntry, why: Glance['why']): Glance {
    this.#considered.add(keyOf(window));
    return { window, why };
  }
}

/** A blind spot, by the host's own mark or by the lists: never considered, titles included. */
export function blind(window: WindowEntry, exclusions: CaptureExclusions): boolean {
  return (
    window.blocked !== undefined ||
    findCaptureBlock({ processName: window.processName, title: window.title }, exclusions) !== null
  );
}
