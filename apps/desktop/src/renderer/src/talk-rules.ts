import { addressedToScout } from '@tagalong/protocol';
import type { ListenMode } from '@tagalong/protocol';

/**
 * The talk key or the mic button starts a held question, except while Scout listens all the
 * time: it already hears, and "Scout" asks. The key then does nothing visible.
 */
export function keyStarts(mode: ListenMode | null): boolean {
  return mode !== 'always';
}

/**
 * A question is over: the bubble goes quiet unless a held question has already started. An
 * always session still running (or resumed) leaves nothing pending.
 */
export function settles(mode: ListenMode | null): boolean {
  return mode !== 'held';
}

/** The words heard so far, without the "Scout" they start with. */
export function shownPartial(text: string | null): string | null {
  if (text === null || text === '') return null;
  return addressedToScout(text) ?? text;
}

/**
 * A microphone that cannot open fails again on every retry (always listening retries each
 * time the system voice stops): its note is told once per run of failures.
 */
export class FailureStreak {
  #failing = false;

  /** Another failure: true if it is the first of the run. */
  fail(): boolean {
    const first = !this.#failing;
    this.#failing = true;
    return first;
  }

  /** Something worked, or the person acted: the next failure is told again. */
  clear(): void {
    this.#failing = false;
  }
}
