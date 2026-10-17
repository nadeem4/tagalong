/**
 * The status marks main holds for every window: a plain map of marks, the top one by the shared
 * order, and an optional time limit per mark. No I/O; main broadcasts each change. Contains
 * StatusMarks, markListening and clearBrainMarks.
 */

import { topStatus } from '@tagalong/protocol';
import type { StatusId, StatusMark } from '@tagalong/protocol';
import type { AlwaysListening } from './always-listening';

export class StatusMarks {
  readonly #marks = new Map<StatusId, StatusMark>();
  readonly #timers = new Map<StatusId, ReturnType<typeof setTimeout>>();
  readonly #listeners = new Set<(top: StatusMark | null) => void>();
  #top: StatusMark | null = null;

  /** Sets or replaces a mark; with `ttlMs` it clears itself after that long. */
  set(mark: StatusMark, ttlMs?: number): void {
    clearTimeout(this.#timers.get(mark.id));
    this.#timers.delete(mark.id);
    if (ttlMs !== undefined) {
      this.#timers.set(
        mark.id,
        setTimeout(() => this.clear(mark.id), ttlMs),
      );
    }
    this.#marks.set(mark.id, mark);
    this.#changed();
  }

  clear(id: StatusId): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    if (this.#marks.delete(id)) this.#changed();
  }

  top(): StatusMark | null {
    return this.#top;
  }

  onChange(listener: (top: StatusMark | null) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #changed(): void {
    const next = topStatus(this.#marks.values());
    if (next === this.#top) return;
    this.#top = next;
    for (const listener of [...this.#listeners]) {
      try {
        listener(next);
      } catch (error) {
        console.warn('[status] a listener failed:', error);
      }
    }
  }
}

/** How long "Listening" shows on Scout after Always listening comes on. */
export const LISTENING_MARK_MS = 8_000;

/**
 * "Listening" on Scout for a few seconds at launch when Always listening is on, and each time
 * it is switched on; switching it off clears it. A pause changes only the listening dot.
 */
export function markListening(
  marks: StatusMarks,
  listening: Pick<AlwaysListening, 'state' | 'onChange'>,
): void {
  let on = listening.state.on;
  if (on) marks.set({ id: 'listening-on' }, LISTENING_MARK_MS);
  listening.onChange((state) => {
    if (state.on && !on) marks.set({ id: 'listening-on' }, LISTENING_MARK_MS);
    if (!state.on) marks.clear('listening-on');
    on = state.on;
  });
}

const BRAIN_MARKS = ['brain-signed-out', 'brain-no-sign-in', 'brain-no-key'] as const;

/** Scout can think again: a turn answered, or the sign-in check came back signed in. */
export function clearBrainMarks(marks: StatusMarks): void {
  for (const id of BRAIN_MARKS) marks.clear(id);
}
