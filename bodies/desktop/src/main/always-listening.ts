/**
 * Whether Scout listens all the time, and whether that is paused for a call or full screen,
 * or while the pets are hidden. It starts from the saved setting and main saves it on each
 * change; the class itself stays pure, with no I/O. Only the person switches it on, and it
 * never switches itself on. Every window that shows it follows this one state.
 * Contains AlwaysListening, listeningPaused and listeningBlocked, startListeningGuard and
 * saveListening.
 */

import { callOrFullScreenInFront } from './front-window';
import type { Settings, SettingsPatch } from '../shared/settings';
import type { WindowEntry } from '@tagalong/ui/shapes';
import type { ListeningState } from '../shared/ipc';

export type { ListeningState };

export class AlwaysListening {
  #state: ListeningState;
  readonly #listeners = new Set<(state: ListeningState) => void>();

  constructor(initialOn = false) {
    this.#state = { on: initialOn, paused: false, followUp: false };
  }

  get state(): ListeningState {
    return this.#state;
  }

  set(on: boolean): ListeningState {
    this.#move({ ...this.#state, on, followUp: on && this.#state.followUp });
    return this.#state;
  }

  setPaused(paused: boolean): void {
    this.#move({ ...this.#state, paused, followUp: !paused && this.#state.followUp });
  }

  /** The panel's follow-up window opened or closed; it opens only while listening is live. */
  setFollowUp(open: boolean): void {
    this.#move({ ...this.#state, followUp: open && this.#state.on && !this.#state.paused });
  }

  onChange(listener: (state: ListeningState) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #move(next: ListeningState): void {
    const now = this.#state;
    if (next.on === now.on && next.paused === now.paused && next.followUp === now.followUp) return;
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

/**
 * A call or a full-screen window in front: listening waits, as keeping an eye does. It is the
 * front window that counts, so a Teams window in front pauses listening even with no call.
 */
export function listeningBlocked(windows: readonly WindowEntry[]): boolean {
  return callOrFullScreenInFront(windows);
}

/**
 * Listening waits for a call or a full-screen window, and while the pets are hidden (the
 * tray's Hide pets): the mark on Scout is then never out of sight while the mic is open.
 */
export function listeningPaused(why: { blocked: boolean; petsShown: boolean }): boolean {
  return why.blocked || !why.petsShown;
}

export const LISTENING_GUARD_MS = 2_000;

/** Why the guard paused listening, for the log: the kind of window and its app, never its title. */
function blockReason(windows: readonly WindowEntry[]): string {
  const front = windows.find((window) => window.state === 'foreground');
  const kind = front?.fullScreen === true ? 'a full-screen window' : 'a call app';
  return `${kind} in front (${front?.processName ?? 'unknown'})`;
}

/**
 * Checks the front window while listening is on: every 2 s, and at once when it comes on (at
 * launch or switched on), so the mic never opens for a moment during a call. Switched off, it
 * forgets its answer (unblocking if it had blocked). A failed listing keeps the last answer.
 */
export function startListeningGuard(options: {
  listening: Pick<AlwaysListening, 'state' | 'onChange'>;
  list: () => Promise<WindowEntry[]>;
  onBlocked: (blocked: boolean) => void;
}): () => void {
  const on = (): boolean => options.listening.state.on;
  let last: boolean | null = null;
  let running = false;
  const check = (): void => {
    if (running || !on()) return;
    running = true;
    options
      .list()
      .then((windows) => {
        // Switched off while the windows were listed: the answer no longer counts.
        if (!on()) return;
        const blocked = listeningBlocked(windows);
        if (blocked !== last) {
          // Visible in the log next time: which kind of window paused it, and the app.
          if (blocked) console.warn(`[listening] paused: ${blockReason(windows)}`);
          else if (last === true) console.warn('[listening] resumed');
          last = blocked;
          options.onBlocked(blocked);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  let wasOn = on();
  const unsubscribe = options.listening.onChange((state) => {
    if (state.on === wasOn) return;
    wasOn = state.on;
    if (state.on) {
      check();
      return;
    }
    const blocked = last;
    last = null;
    if (blocked === true) options.onBlocked(false);
  });
  const timer = setInterval(check, LISTENING_GUARD_MS);
  check();
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}

/**
 * Saves `on` each time it changes, to the settings file; `paused` is never saved, as a call or
 * full screen is not a choice the person made. A save that fails is tried again at the next
 * change, so switching off is never lost.
 */
export function saveListening(options: {
  /** What the settings file holds now. */
  saved: boolean;
  settingsStore: () => { set(patch: SettingsPatch): Settings };
  onSaved: (settings: Settings) => void;
}): (state: ListeningState) => void {
  let saved = options.saved;
  return (state) => {
    if (state.on === saved) return;
    try {
      options.onSaved(options.settingsStore().set({ listening: { always: state.on } }));
      saved = state.on;
    } catch (error) {
      console.warn('[main] could not save Always listening', error);
    }
  };
}
