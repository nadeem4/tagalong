import type { CaptureExclusions, HandoffFinishedParams, WindowEntry } from '@tagalong/protocol';
import { blind, callOrFullScreenInFront, looksLikeTrouble } from './lookout';

/**
 * Scout's face reacts to what the front window's title says: a wince when a build or a test
 * newly fails, a cheer when it passes. Titles only, from the window list keeping an eye
 * already gets: no text is read and no model is asked.
 */

/** A reaction on the pet's face. */
export type Reaction = 'wince' | 'cheer';

/** At most one reaction a minute, so a flapping title cannot make the pet twitch. */
export const MOOD_COOLDOWN_MS = 60_000;

/** Words a passing build or test run puts in a title. */
const PASSING = /\b(passed|passing|succeeded|success)\b|✓|✔/i;

/** Tests passing, in an expert's last words. */
const TESTS_PASS = /\b(\d+ )?tests? pass(ed|ing)?\b|\b\d+ passed\b/i;
/** A failure counted in an expert's last words. */
const FAILED = /\bfail/i;

type TitleState = 'trouble' | 'passing' | 'plain';

function stateOf(title: string): TitleState {
  if (looksLikeTrouble(title)) return 'trouble';
  return PASSING.test(title) ? 'passing' : 'plain';
}

export class MoodWatch {
  readonly #clock: { now(): number };
  /** What each window's title last said, by window id. */
  readonly #seen = new Map<string, TitleState>();
  #lastReactedAt = Number.NEGATIVE_INFINITY;

  constructor(clock: { now(): number }) {
    this.#clock = clock;
  }

  /** The reaction the front window's title earns now, or null. */
  observe(windows: readonly WindowEntry[], exclusions: CaptureExclusions): Reaction | null {
    if (callOrFullScreenInFront(windows)) return null;
    const front = windows.find((window) => window.state === 'foreground');
    if (front === undefined || blind(front, exclusions)) return null;

    const now = stateOf(front.title);
    const before = this.#seen.get(front.id);
    this.#seen.set(front.id, now);
    if (now === before) return null;

    const reaction: Reaction | null =
      now === 'trouble' ? 'wince' : now === 'passing' || before === 'trouble' ? 'cheer' : null;
    if (reaction === null) return null;
    const at = this.#clock.now();
    if (at - this.#lastReactedAt < MOOD_COOLDOWN_MS) return null;
    this.#lastReactedAt = at;
    return reaction;
  }
}

/** The reaction a finished hand-off earns: plain done has its own face already. */
export function moodForHandoff(params: HandoffFinishedParams): Reaction | null {
  if (params.state === 'error') return 'wince';
  if (params.state !== 'done' || params.text === undefined) return null;
  if (FAILED.test(params.text)) return /\b\d+ failed\b/i.test(params.text) ? 'wince' : null;
  return TESTS_PASS.test(params.text) ? 'cheer' : null;
}
