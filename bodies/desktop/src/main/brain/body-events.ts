/**
 * The desktop's body events to the brain: `back` (the person returned after a long idle),
 * `focus` (the front window changed) and `read_aloud` (what Scout's voice setting asks for).
 * Facts only; the brain decides whether to speak. A blocked window is never reported, so an
 * excluded app never leaves the machine.
 */
import type { ReadAloudEventData } from '@tagalong/contract';
import type { WindowEntry } from '@tagalong/ui/shapes';
import { AWAY_AFTER_MS } from '../presence';
import type { Settings } from '../../shared/settings';
import { chosenMouth } from '../../shared/voice';

/**
 * The `read_aloud` event data: Scout talks, the voice and speed, and whether the system voice
 * was picked (the brain then sends text only and never loads its own voice). Sent on every
 * connect and whenever these settings change.
 */
export function readAloudEvent(voice: Settings['voice']): ReadAloudEventData {
  return {
    on: voice.enabled,
    voice: voice.voice,
    speed: voice.speed,
    system_voice: chosenMouth(voice) === 'system',
  };
}

/** How often the front window is read. */
const FOCUS_POLL_MS = 5_000;

/** Sends one body event; true when the brain got it (false when it was offline). */
type Send = (name: string, data: unknown) => boolean;

/** Feeds from the presence callback, which owns the away threshold; sends `back` on return. */
export function createBackSender(options: {
  send: Send;
  now: () => number;
  /** The system idle time in ms: presence reports `away` only after the idle already ran. */
  idleMs: () => number;
}): (change: 'away' | 'back') => void {
  let awaySince: number | null = null;
  return (change) => {
    if (change === 'away') {
      awaySince = options.now() - options.idleMs();
      return;
    }
    if (awaySince === null) return;
    const seconds = Math.floor((options.now() - awaySince) / 1000);
    awaySince = null;
    // A short screen lock is not a return: only a full away period counts.
    if (seconds < AWAY_AFTER_MS / 1000) return;
    options.send('back', { idle_seconds: seconds });
  };
}

/** The foreground window, or null when there is none or it is blocked by an exclusion. */
export function frontWindow(
  windows: readonly WindowEntry[],
): { app: string; title: string } | null {
  const front = windows.find((window) => window.state === 'foreground');
  if (front === undefined || front.blocked !== undefined) return null;
  return { app: front.processName, title: front.title };
}

/**
 * Polls the front window and sends `focus` only when it changed. When nothing may be shown
 * (an excluded window in front, or sight paused) an empty focus goes once, so the brain does
 * not keep the old app "in front". `send` says whether the brain got it; a send it missed
 * (offline) is tried again next tick. Returns the stop.
 */
export function startFocusWatch(options: {
  front: () => Promise<{ app: string; title: string } | null>;
  send: Send;
  enabled: () => boolean;
  intervalMs?: number;
}): () => void {
  let last = '';
  let running = false;
  const report = (app: string, title: string): void => {
    const key = app === '' ? '' : JSON.stringify([app, title]);
    if (key === last) return;
    if (options.send('focus', { app, title })) last = key;
  };
  const timer = setInterval(() => {
    if (running) return;
    if (!options.enabled()) {
      report('', '');
      return;
    }
    running = true;
    options
      .front()
      .then((window) => {
        if (window === null) report('', '');
        else report(window.app, window.title);
      })
      // A failed listing: try again next tick.
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, options.intervalMs ?? FOCUS_POLL_MS);
  return () => clearInterval(timer);
}
