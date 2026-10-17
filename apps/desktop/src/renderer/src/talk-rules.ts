/**
 * The pure rules behind talk.ts: when a question is over, what words to show, and saying a
 * microphone or ears failure once per run of failures. Contains settles, shownPartial, micNote,
 * FailureStreak, EarsNotes and NOTHING_HEARD.
 */
import { addressedToScout } from '@tagalong/protocol';
import type { ListenMode } from '@tagalong/protocol';
import { micFailure } from './setup-ears';

export const FIRST_TIME =
  'The first time, Tagalong downloads its speech models (about 43 MB). Speech is turned into text on this PC.';
const EARS_FAILED = 'Listening stopped. Try again.';
/** A held question that heard no words: a bubble note, never said aloud. */
export const NOTHING_HEARD = 'Nothing heard.';
const MIC_BUSY =
  'Another app is using the microphone. Close it and try again, or pick another in Settings.';
const NO_MICROPHONE =
  'The microphone could not be opened. Check that Windows lets apps use it, or pick another in Settings.';

/** The note for a microphone that would not open: busy in another app, or not usable. */
export function micNote(error: unknown): string {
  return micFailure(error) === 'busy' ? MIC_BUSY : NO_MICROPHONE;
}

/**
 * A question is over: the bubble goes quiet unless a held question has already started. An
 * always session still running (or resumed) leaves nothing pending.
 */
export function settles(mode: ListenMode | null): boolean {
  return mode !== 'held';
}

/**
 * The words heard so far. Listening all the time, without the "Scout" they start with; a held
 * question needs no name, so it shows as said.
 */
export function shownPartial(text: string | null, mode: ListenMode): string | null {
  if (text === null || text === '') return null;
  if (mode === 'held') return text;
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

/**
 * The note the ears' status leaves in the bubble. The first time, the models download; a
 * failure (offline, models that will not start) is said once, and the retries that always
 * listening makes later (each a new download, each failing again) neither repeat it nor
 * leave the first-time note behind.
 */
export class EarsNotes {
  /** The failure said and not yet cleared. */
  #told: string | null = null;

  /** `loading` or `ready`, given the note shown now. */
  status(note: string | null, status: 'loading' | 'ready'): string | null {
    if (status === 'loading') return this.#told === null ? FIRST_TIME : note;
    const told = this.#told;
    this.#told = null;
    return note === FIRST_TIME || (told !== null && note === told) ? null : note;
  }

  /** The ears failed while something listened, given the note shown now. */
  failed(note: string | null, message: string | undefined): string | null {
    if (this.#told !== null) return note === FIRST_TIME ? null : note;
    this.#told = message ?? EARS_FAILED;
    return this.#told;
  }

  /** The talk key or the mic button started a question: the next failure is said again. */
  clear(): void {
    this.#told = null;
  }
}
