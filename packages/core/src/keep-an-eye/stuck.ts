import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import { blind, callOrFullScreenInFront, looksLikeTrouble } from './lookout';

/**
 * Stuck? An error that has stayed up for three minutes earns one offer to hand it to an
 * expert. Titles only, from the window list keeping an eye already gets: nothing is read and
 * no model is asked. The window's text is read later, and only if the person takes the offer.
 */

/** How long an error stays up before Scout offers to hand it over. */
export const STUCK_MS = 3 * 60_000;

/** At most one offer in this long. */
export const STUCK_COOLDOWN_MS = 30 * 60_000;

/** An error that has been up long enough, and the titles to guess its project from. */
export interface Stuck {
  window: WindowEntry;
  projectHint: string;
}

/** The id and the title: a rerun that changes the title starts the three minutes again. */
function keyOf(window: WindowEntry): string {
  return `${window.id}\n${window.title}`;
}

export class StuckWatch {
  readonly #clock: { now(): number };
  /** Each error still open, by key, and when it was first seen. */
  readonly #since = new Map<string, number>();
  /** Errors already offered, while they stay open. */
  readonly #offered = new Set<string>();
  #lastOfferedAt = Number.NEGATIVE_INFINITY;
  #quietUntil = Number.NEGATIVE_INFINITY;
  /** The last window in front without trouble in its title: usually the editor. */
  #lastClean: string | null = null;

  constructor(clock: { now(): number }) {
    this.#clock = clock;
  }

  /** The error to offer help with now, or null. Each error is offered once. */
  observe(windows: readonly WindowEntry[], exclusions: CaptureExclusions): Stuck | null {
    const now = this.#clock.now();
    const open = new Set<string>();
    for (const window of windows) {
      if (window.state === 'minimized' || !looksLikeTrouble(window.title)) continue;
      if (blind(window, exclusions)) continue;
      const key = keyOf(window);
      open.add(key);
      if (!this.#since.has(key)) this.#since.set(key, now);
    }
    // Only errors still up are remembered, so a closed one starts afresh and the maps stay small.
    for (const key of this.#since.keys()) if (!open.has(key)) this.#since.delete(key);
    for (const key of this.#offered) if (!open.has(key)) this.#offered.delete(key);

    const front = windows.find((window) => window.state === 'foreground');
    if (front === undefined || blind(front, exclusions)) return null;
    if (!looksLikeTrouble(front.title)) {
      if (front.title.trim() !== '') this.#lastClean = front.title;
      return null;
    }

    if (now < this.#quietUntil || now - this.#lastOfferedAt < STUCK_COOLDOWN_MS) return null;
    if (callOrFullScreenInFront(windows)) return null;
    const key = keyOf(front);
    const since = this.#since.get(key);
    if (since === undefined || this.#offered.has(key) || now - since < STUCK_MS) return null;

    this.#offered.add(key);
    this.#lastOfferedAt = now;
    const projectHint =
      this.#lastClean === null ? front.title : `${front.title} - ${this.#lastClean}`;
    return { window: front, projectHint };
  }

  /** "Not now": no offer until then. */
  quietUntil(at: number): void {
    this.#quietUntil = at;
  }
}
