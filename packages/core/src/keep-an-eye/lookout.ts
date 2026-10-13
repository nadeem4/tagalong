import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import { findCaptureBlock, normalizeProcessName } from '../perception/exclusions';

/**
 * Decides, from window titles alone, when one window is worth a closer look.
 *
 * Nothing here reads a screen or calls a model. The host sends the window list every few
 * seconds and almost every snapshot ends in this file with "not now". A look happens when
 * the person has settled on a window for half a minute, or when a title reads like
 * something broke, and never twice on the same window.
 */

/** How long the person stays on a window before it is worth a look. */
export const SETTLE_MS = 30_000;

/** At most one remark in this long. */
export const COOLDOWN_MS = 10 * 60_000;

/** How long "Not now" keeps the pet quiet. */
export const NOT_NOW_MS = 60 * 60_000;

/** Words a failing build, a crash or a stack trace put in a title. Kept short on purpose. */
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
  #lastSpokeAt = Number.NEGATIVE_INFINITY;
  #quietUntil = Number.NEGATIVE_INFINITY;

  constructor(clock: { now(): number }) {
    this.#clock = clock;
  }

  /** The one window to look at now, or null. A window returned here is never returned again. */
  observe(windows: readonly WindowEntry[], exclusions: CaptureExclusions): Glance | null {
    const now = this.#clock.now();
    const front = windows.find((window) => window.state === 'foreground');
    // Settling is tracked even while quiet, so the thirty seconds are real ones.
    const frontKey = front === undefined ? null : keyOf(front);
    if (frontKey !== this.#focus?.key) {
      this.#focus = frontKey === null ? null : { key: frontKey, since: now };
    }

    if (now < this.#quietUntil || now - this.#lastSpokeAt < COOLDOWN_MS) return null;
    if (front !== undefined && (front.fullScreen === true || isMeeting(front))) return null;

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

  /** A remark was shown: the ten minutes start now. */
  spoke(): void {
    this.#lastSpokeAt = this.#clock.now();
  }

  /** "Not now": quiet for an hour. Returns when the quiet ends. */
  notNow(): number {
    this.#quietUntil = this.#clock.now() + NOT_NOW_MS;
    return this.#quietUntil;
  }

  /** Whether a remark may be shown right now, for one that was being written meanwhile. */
  mayspeak(): boolean {
    const now = this.#clock.now();
    return now >= this.#quietUntil && now - this.#lastSpokeAt >= COOLDOWN_MS;
  }

  #look(window: WindowEntry, why: Glance['why']): Glance {
    this.#considered.add(keyOf(window));
    return { window, why };
  }
}

/** A blind spot, by the host's own mark or by the lists: never considered, titles included. */
function blind(window: WindowEntry, exclusions: CaptureExclusions): boolean {
  return (
    window.blocked !== undefined ||
    findCaptureBlock({ processName: window.processName, title: window.title }, exclusions) !== null
  );
}
