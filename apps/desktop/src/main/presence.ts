/**
 * Whether the person is at the computer, for Scout's dozing face. It reads one number, the
 * system's idle time, every 15 s, and hears the screen lock and unlock. Nothing on screen
 * is read, and nothing leaves this computer.
 * Also the wellbeing tick. Contains watchPresence, startPresence and startWellbeingTick.
 */

import type { WindowEntry } from '@tagalong/protocol';

/** No input for this long and Scout dozes. A constant, not a setting. */
export const AWAY_AFTER_MS = 5 * 60_000;

/** How often the idle time is read. */
export const PRESENCE_POLL_MS = 15_000;

export interface Presence {
  /** The screen locked: away at once. */
  lock(): void;
  /** The screen unlocked: back at once. */
  unlock(): void;
  stop(): void;
}

export function startPresence(options: {
  /** The system's idle time, in ms (`powerMonitor.getSystemIdleTime()` is in seconds). */
  idleMs: () => number;
  onChange: (change: 'away' | 'back') => void;
}): Presence {
  let away = false;
  let locked = false;
  const move = (next: boolean): void => {
    if (next === away) return;
    away = next;
    options.onChange(next ? 'away' : 'back');
  };
  const timer = setInterval(() => {
    if (!locked) move(options.idleMs() >= AWAY_AFTER_MS);
  }, PRESENCE_POLL_MS);
  return {
    lock: () => {
      locked = true;
      move(true);
    },
    unlock: () => {
      locked = false;
      move(false);
    },
    stop: () => clearInterval(timer),
  };
}

/** How often gentle nudges get the idle time and the titles. */
export const WELLBEING_TICK_MS = 60_000;

/**
 * Gentle nudges' feed: once a minute, the idle time and the window titles (no text, no
 * picture) go to the engine, which decides everything else. While the setting is off or
 * sight is paused, nothing is listed or sent. Returns the stop for quit.
 */
export function startWellbeingTick(options: {
  /** Read every tick: the setting and the sight pause change while the app runs. */
  enabled: () => boolean;
  /** The system's idle time, in ms. */
  idleMs: () => number;
  /** Titles only, with the blind spots already marked. */
  list: () => Promise<WindowEntry[]>;
  send: (params: { idleMs: number; windows: WindowEntry[] }) => Promise<unknown>;
}): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !options.enabled()) return;
    running = true;
    const idleMs = options.idleMs();
    options
      .list()
      .then((windows) => options.send({ idleMs, windows }))
      // A failed listing or an engine that is restarting: try next minute.
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, WELLBEING_TICK_MS);
  return () => clearInterval(timer);
}

/** The slice of Electron's `powerMonitor` presence reads. */
export interface PowerMonitorLike {
  /** Whole seconds since the last input. */
  getSystemIdleTime(): number;
  on(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown;
  removeListener(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown;
}

/**
 * Main's one call: presence from the power monitor, sent to the avatar as
 * `presence.away`/`presence.back` on the turn-event channel. Returns the stop for quit.
 */
export function watchPresence(
  power: PowerMonitorLike,
  send: (event: { type: 'presence.away' | 'presence.back' }) => void,
): () => void {
  const presence = startPresence({
    idleMs: () => power.getSystemIdleTime() * 1000,
    onChange: (change) => send({ type: change === 'away' ? 'presence.away' : 'presence.back' }),
  });
  const lock = (): void => presence.lock();
  const unlock = (): void => presence.unlock();
  power.on('lock-screen', lock);
  power.on('unlock-screen', unlock);
  return () => {
    presence.stop();
    power.removeListener('lock-screen', lock);
    power.removeListener('unlock-screen', unlock);
  };
}
