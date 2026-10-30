/**
 * The status marks main holds for every window: a plain map of marks, the top one by the shared
 * order, and an optional time limit per mark. No I/O; main broadcasts each change. Contains
 * StatusMarks, markListening, setPanelMark and markBrainLink.
 */

import { topStatus } from '@tagalong/protocol';
import type { StatusId, StatusMark } from '@tagalong/protocol';
import type { AlwaysListening } from './always-listening';
import type { BrainStatus } from '@tagalong/contract';

export class StatusMarks {
  readonly #marks = new Map<StatusId, StatusMark>();
  readonly #timers = new Map<StatusId, ReturnType<typeof setTimeout>>();
  readonly #onChange: (top: StatusMark | null) => void;
  #top: StatusMark | null = null;

  /** `onChange` hears the new top mark (or null) each time it changes. */
  constructor(onChange: (top: StatusMark | null) => void = () => undefined) {
    this.#onChange = onChange;
  }

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

  #changed(): void {
    const next = topStatus(this.#marks.values());
    if (next === this.#top) return;
    this.#top = next;
    this.#onChange(next);
  }
}

/** How long "Listening" shows on Scout after Always listening comes on. */
export const LISTENING_MARK_MS = 8_000;

/**
 * "Listening" on Scout for a few seconds at launch when Always listening is on, and each time
 * it is switched on; switching it off clears it. "Not listening" while it is on but paused
 * (a call, full screen).
 */
export function markListening(
  marks: StatusMarks,
  listening: Pick<AlwaysListening, 'state' | 'onChange'>,
): void {
  const paused = (state: { on: boolean; paused: boolean }): void => {
    if (state.on && state.paused) marks.set({ id: 'listening-paused' });
    else marks.clear('listening-paused');
  };
  let on = listening.state.on;
  if (on) marks.set({ id: 'listening-on' }, LISTENING_MARK_MS);
  paused(listening.state);
  listening.onChange((state) => {
    if (state.on && !on) marks.set({ id: 'listening-on' }, LISTENING_MARK_MS);
    if (!state.on) marks.clear('listening-on');
    paused(state);
    on = state.on;
  });
}

/** How long "Say “Scout”" shows after a question that did not start with the name. */
export const SAY_NAME_MARK_MS = 8_000;

/** The marks only the panel knows about: the microphone failing, and the hint to say the name. */
const PANEL_MARKS: ReadonlySet<string> = new Set(['mic-busy', 'mic-failed', 'say-name']);

/**
 * A mark set or cleared from the panel. Only the panel's own marks: a window can never set or
 * clear the brain or ears marks. Throws for anything else.
 */
export function setPanelMark(marks: StatusMarks, id: unknown, on: unknown): void {
  if (typeof id !== 'string' || !PANEL_MARKS.has(id) || typeof on !== 'boolean') {
    throw new Error('Not a mark the panel sets.');
  }
  const mark = id as 'mic-busy' | 'mic-failed' | 'say-name';
  if (!on) marks.clear(mark);
  else marks.set({ id: mark }, mark === 'say-name' ? SAY_NAME_MARK_MS : undefined);
}

/** Whether the brain can be reached: Offline while it is down, Update when it is too new. */
export function markBrainLink(marks: StatusMarks, status: BrainStatus): void {
  if (status === 'connecting') return;
  if (status === 'offline') marks.set({ id: 'brain-offline' });
  else marks.clear('brain-offline');
  if (status === 'outdated') marks.set({ id: 'brain-outdated' });
  else marks.clear('brain-outdated');
}
