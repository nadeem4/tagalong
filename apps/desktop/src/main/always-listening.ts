import { isMeeting } from '@tagalong/core';
import type { Settings, SettingsPatch, WindowEntry } from '@tagalong/protocol';
import type { ListeningState } from '../shared/ipc';
import type { EngineCall } from './ipc/handle';

export type { ListeningState };

/**
 * Whether Scout listens all the time, and whether that is paused for a call or full
 * screen, or while the pets are hidden. It starts from the saved setting and main saves it on each change; the class
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

/**
 * A call or a full-screen window in front: listening waits, as keeping an eye does. It is the
 * front window that counts, so a Teams window in front pauses listening even with no call.
 */
export function listeningBlocked(windows: readonly WindowEntry[]): boolean {
  const front = windows.find((window) => window.state === 'foreground');
  return front !== undefined && (front.fullScreen === true || isMeeting(front));
}

/**
 * Listening waits for a call or a full-screen window, and while the pets are hidden (the
 * tray's Hide pets): the mark on Scout is then never out of sight while the mic is open.
 */
export function listeningPaused(why: { blocked: boolean; petsShown: boolean }): boolean {
  return why.blocked || !why.petsShown;
}

export const LISTENING_GUARD_MS = 2_000;

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
 * Saves `on` each time it changes; `paused` is never saved, as a call or full screen is not a
 * choice the person made. With no engine it saves to the settings file, as Settings does. A
 * save that fails is tried again at the next change, so switching off is never lost. Saves run
 * one at a time, and each one done saves again if the choice changed meanwhile, so a quick
 * switch on then off never leaves "on" in the file; saved settings arrive in order.
 */
export function saveListening(options: {
  /** What the settings file holds now. */
  saved: boolean;
  host: () => { client: EngineCall } | null;
  settingsStore: () => { set(patch: SettingsPatch): Settings };
  onSaved: (settings: Settings) => void;
}): (state: ListeningState) => void {
  let saved = options.saved;
  let wanted = saved;
  let saving = false;
  const failed = (error: unknown): void =>
    console.warn('[main] could not save Always listening', error);
  const next = (): void => {
    if (saving || wanted === saved) return;
    const on = wanted;
    const patch = { listening: { always: on } };
    const done = (settings: Settings): void => {
      saved = on;
      options.onSaved(settings);
    };
    const host = options.host();
    if (host === null) {
      try {
        done(options.settingsStore().set(patch));
      } catch (error) {
        failed(error);
        return;
      }
      next();
      return;
    }
    saving = true;
    host.client
      .call('settings.set', { patch })
      .then(({ settings }) => {
        saving = false;
        done(settings);
        next();
      })
      .catch((error: unknown) => {
        saving = false;
        failed(error);
      });
  };
  return (state) => {
    wanted = state.on;
    next();
  };
}
