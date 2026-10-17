/**
 * How long the person has been at it, from the idle time the host sends once a minute.
 * Contains `ActiveTime` and its timing constants. Timing only: whether that is worth a word
 * is the mind's call (the `long-stretch` check-in).
 */

/** Unbroken activity this long, and a long stretch is due. */
export const STRETCH_MS = 90 * 60_000;
/** An idle gap this long is a break: the stretch starts over. */
export const BREAK_MS = 5 * 60_000;
/** Late at night, this much activity before a late check-in is due. */
export const LATE_ACTIVE_MS = 30 * 60_000;
/** Late night runs from this hour... */
export const LATE_FROM_HOUR = 23;
/** ...to this one. */
export const LATE_UNTIL_HOUR = 5;
/** Two late check-ins closer than this are the same night (late night is six hours long). */
const SAME_NIGHT_MS = 12 * 60 * 60_000;

export interface ActiveReading {
  /** Unbroken activity so far. */
  activeMs: number;
  /** What is due and not yet consumed: one per stretch, one late per night. */
  due: 'stretch' | 'late' | null;
  /** This tick ended a stretch with a break. */
  brokeOff: boolean;
}

export class ActiveTime {
  #activeSince: number | null = null;
  #lastTickAt = Number.NEGATIVE_INFINITY;
  #stretchSaid = false;
  #lateSaidAt = Number.NEGATIVE_INFINITY;

  observe(idleMs: number, now: number, hour: number): ActiveReading {
    const sinceLastTick = now - this.#lastTickAt;
    this.#lastTickAt = now;
    let brokeOff = false;
    // No ticks for a break's length (the computer slept, the setting was off) or a clock set
    // back counts as a break, so waking up never finds an old stretch due.
    if (idleMs >= BREAK_MS || sinceLastTick >= BREAK_MS || sinceLastTick < 0) {
      brokeOff = this.#activeSince !== null;
      this.reset();
    }
    if (idleMs < BREAK_MS) this.#activeSince ??= now;
    const activeMs = this.#activeSince === null ? 0 : now - this.#activeSince;
    const lateHour = hour >= LATE_FROM_HOUR || hour < LATE_UNTIL_HOUR;
    const due =
      lateHour && activeMs >= LATE_ACTIVE_MS && now - this.#lateSaidAt >= SAME_NIGHT_MS
        ? 'late'
        : activeMs >= STRETCH_MS && !this.#stretchSaid
          ? 'stretch'
          : null;
    return { activeMs, due, brokeOff };
  }

  /** The mind was asked about it: not due again this stretch (or, late, this night). */
  consume(due: 'stretch' | 'late', now: number): void {
    this.#stretchSaid = true;
    if (due === 'late') this.#lateSaidAt = now;
  }

  /** The stretch starts over. */
  reset(): void {
    this.#activeSince = null;
    this.#stretchSaid = false;
  }
}
