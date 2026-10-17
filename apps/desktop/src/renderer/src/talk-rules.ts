/**
 * The pure rules behind talk.ts: when a question is over, what words to show, and saying a
 * microphone or ears failure once per run of failures, and when the follow-up window opens.
 * Contains settles, shownPartial, micMark, micNote, FailureStreak, FollowUpCue, EarsNotes,
 * HeardInbox and NOTHING_HEARD.
 */
import { STATUS_WORDS, addressedToScout } from '@tagalong/protocol';
import type { ListenMode } from '@tagalong/protocol';
import { micFailure } from './setup-ears';

export const FIRST_TIME =
  'The first time, Tagalong downloads its speech models (about 43 MB). Speech is turned into text on this PC.';
const EARS_FAILED = 'Listening stopped. Try again.';
/** A held question that heard no words: a bubble note, never said aloud. */
export const NOTHING_HEARD = 'Nothing heard.';
/** The mark on Scout for a microphone that would not open: busy in another app, or not usable. */
export function micMark(error: unknown): 'mic-busy' | 'mic-failed' {
  return micFailure(error) === 'busy' ? 'mic-busy' : 'mic-failed';
}

/** The bubble note for the same failure: the mark's sentence. */
export function micNote(error: unknown): string {
  return STATUS_WORDS[micMark(error)].detail;
}

/**
 * When the follow-up window opens: as Scout's spoken answer to a question asked by voice ends,
 * all of it (a streamed answer can leave the voice quiet between sentences). Not when the
 * person cut Scout off (the stop button or key, the close, talking over it), nor when the
 * answer said nothing aloud.
 */
export class FollowUpCue {
  #asked = false;
  #spoke = false;
  #busy = false;

  /** A question was heard by voice: its spoken answer may open the window. */
  asked(): void {
    this.#asked = true;
    this.#spoke = false;
  }

  /** The person had enough: this answer opens nothing. */
  hushed(): void {
    this.#asked = false;
  }

  /**
   * Scout speaking, and its spoken answer still streaming in: true when the window should open
   * now, once both are over and Scout said some of it aloud.
   */
  update(speaking: boolean, answering: boolean): boolean {
    if (speaking && this.#asked) this.#spoke = true;
    const busy = speaking || answering;
    const ended = this.#busy && !busy;
    this.#busy = busy;
    if (!ended || !this.#asked) return false;
    this.#asked = false;
    return this.#spoke;
  }
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

/**
 * Where each heard question goes: to the bubble listening for it, or held until one does.
 * The bubble is not there while a one-line hello, remark or routine line takes its place,
 * nor while Scout is still waking; a question heard then is asked as soon as it mounts,
 * never dropped.
 */
export class HeardInbox {
  readonly #hearers = new Set<(text: string) => void>();
  #held: string[] = [];

  /** The bubble listens; anything held is asked now, once. */
  subscribe(hear: (text: string) => void): () => void {
    this.#hearers.add(hear);
    const held = this.#held;
    this.#held = [];
    for (const text of held) hear(text);
    return () => void this.#hearers.delete(hear);
  }

  /** True when a bubble took it; false when it is held for the next one. */
  deliver(text: string): boolean {
    if (this.#hearers.size === 0) {
      this.#held.push(text);
      return false;
    }
    for (const hear of this.#hearers) hear(text);
    return true;
  }
}
