/**
 * Scout's face reacts to what the front window's title says: a wince when a build or a test
 * newly fails, a cheer when it passes. Titles only, from the window list keeping an eye
 * already gets: no text is read and no model is asked. Contains MoodWatch and
 * moodForHandoff.
 */
import type { CaptureExclusions, HandoffFinishedParams, WindowEntry } from '@tagalong/protocol';
import { blind, callOrFullScreenInFront, looksLikeTrouble } from './lookout';

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
/** A zero count says nothing either way: "0 failed" is no failure, "0 passed" no pass. */
const ZERO_COUNT = /\b(0|no) (tests? )?\w+/gi;

function withoutZeroCounts(text: string): string {
  return text.replace(ZERO_COUNT, '');
}

type TitleState = 'trouble' | 'passing' | 'plain';

function stateOf(title: string): TitleState {
  const counted = withoutZeroCounts(title);
  if (looksLikeTrouble(counted)) return 'trouble';
  return PASSING.test(counted) ? 'passing' : 'plain';
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
    // Only windows still open are remembered, so the map cannot grow all day.
    const open = new Set(windows.map((window) => window.id));
    for (const id of this.#seen.keys()) if (!open.has(id)) this.#seen.delete(id);
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
  const text = withoutZeroCounts(params.text);
  if (FAILED.test(text)) return /\b\d+ failed\b/i.test(text) ? 'wince' : null;
  return TESTS_PASS.test(text) ? 'cheer' : null;
}
