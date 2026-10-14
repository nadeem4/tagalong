import { isMeeting } from '@tagalong/core';
import type { WindowEntry } from '@tagalong/protocol';

export interface ListeningState {
  on: boolean;
  paused: boolean;
}

/**
 * Whether Scout listens all the time, and whether that is paused for a call or full
 * screen. It starts from the saved setting and main saves it on each change; the class
 * itself stays pure, with no I/O. Only the person switches it on, and it never switches
 * itself on. Every window that shows it follows this one state.
 */
export class AlwaysListening {
  #state: ListeningState;
  readonly #listeners = new Set<(state: ListeningState) => void>();

  constructor(initialOn = false) {
    this.#state = { on: initialOn, paused: false };
  }

  get state(): ListeningState {
    return this.#state;
  }

  set(on: boolean): ListeningState {
    this.#move({ ...this.#state, on });
    return this.#state;
  }

  setPaused(paused: boolean): void {
    this.#move({ ...this.#state, paused });
  }

  onChange(listener: (state: ListeningState) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #move(next: ListeningState): void {
    if (next.on === this.#state.on && next.paused === this.#state.paused) return;
    this.#state = next;
    for (const listener of [...this.#listeners]) {
      try {
        listener(next);
      } catch (error) {
        console.warn('[listening] a listener failed:', error);
      }
    }
  }
}

/** A call or a full-screen window in front: listening waits, as keeping an eye does. */
export function listeningBlocked(windows: readonly WindowEntry[]): boolean {
  const front = windows.find((window) => window.state === 'foreground');
  return front !== undefined && (front.fullScreen === true || isMeeting(front));
}

export const LISTENING_GUARD_MS = 2_000;

/** Checks the front window while listening is on. A failed listing keeps the last answer. */
export function startListeningGuard(options: {
  active: () => boolean;
  list: () => Promise<WindowEntry[]>;
  onBlocked: (blocked: boolean) => void;
}): () => void {
  let last: boolean | null = null;
  let running = false;
  const timer = setInterval(() => {
    if (running || !options.active()) return;
    running = true;
    options
      .list()
      .then((windows) => {
        const blocked = listeningBlocked(windows);
        if (blocked !== last) {
          last = blocked;
          options.onBlocked(blocked);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, LISTENING_GUARD_MS);
  return () => clearInterval(timer);
}
