/**
 * Rolling memory's buffer: the frames and window lists of the last few minutes, oldest dropped
 * first. Contains StoredFrame, Moment and FrameRing.
 */

import type { WindowEntry } from '@tagalong/ui/shapes';

/**
 * One display at one moment, as the ring keeps it.
 *
 * PNG rather than a raw bitmap: a 640-pixel BGRA frame is about 900 KB, so ten minutes of
 * two displays at one frame every five seconds would be over 200 MB. The PNG of the same
 * frame is a tenth of that, and it is decoded only when a diff actually asks for it.
 */
export interface StoredFrame {
  displayId: number;
  png: Buffer;
  width: number;
  height: number;
  /**
   * The display's own pixel size, which `rect` and `bounds` on the wire are measured in.
   * Kept per frame so a diff can map between the two even after the display changes.
   */
  displayWidth: number;
  displayHeight: number;
}

/** Everything rolling memory records at one tick. */
export interface Moment {
  /** Milliseconds since the epoch, from the injected clock. */
  at: number;
  frames: StoredFrame[];
  windows: WindowEntry[];
  focused?: { processName: string; title: string } | undefined;
}

/**
 * The in-memory ring behind rolling memory: a time window rather than a count.
 *
 * Measured in time because that is what the setting promises — "ten minutes" — and a count
 * would quietly mean something else the day the tick interval changes. Never touches disk:
 * there is no serialise, and nothing here imports `fs`.
 */
export class FrameRing {
  #windowMs: number;
  #moments: Moment[] = [];

  constructor(windowMs: number) {
    this.#windowMs = windowMs;
  }

  get windowMs(): number {
    return this.#windowMs;
  }

  get size(): number {
    return this.#moments.length;
  }

  /** Changes how far back the ring reaches. A smaller window evicts at once. */
  setWindow(windowMs: number): void {
    this.#windowMs = windowMs;
    const newest = this.newest();
    if (newest !== undefined) this.evict(newest.at);
  }

  /** Adds a moment and drops everything older than the window behind it. */
  push(moment: Moment): void {
    this.#moments.push(moment);
    this.evict(moment.at);
  }

  /** Drops every moment older than the window before `now`. */
  evict(now: number): void {
    const cutoff = now - this.#windowMs;
    const firstKept = this.#moments.findIndex((moment) => moment.at >= cutoff);
    if (firstKept === -1) this.#moments = [];
    else if (firstKept > 0) this.#moments = this.#moments.slice(firstKept);
  }

  oldest(): Moment | undefined {
    return this.#moments[0];
  }

  newest(): Moment | undefined {
    return this.#moments.at(-1);
  }

  /**
   * The moment closest to `at` that holds a frame of `displayId` (any display if absent).
   * `before` limits the search to moments strictly earlier than it, which is how a diff
   * avoids comparing the frame it just took with itself.
   */
  nearest(at: number, displayId?: number, options: { before?: number } = {}): Moment | undefined {
    let best: Moment | undefined;
    for (const moment of this.#moments) {
      if (options.before !== undefined && moment.at >= options.before) continue;
      if (displayId !== undefined && !moment.frames.some((f) => f.displayId === displayId)) {
        continue;
      }
      if (best === undefined || Math.abs(moment.at - at) < Math.abs(best.at - at)) best = moment;
    }
    return best;
  }

  clear(): void {
    this.#moments = [];
  }
}
