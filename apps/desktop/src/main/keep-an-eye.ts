/**
 * The desktop's half of keeping an eye on things: every few seconds, the window titles go
 * to the engine, which decides everything else. No picture is taken and no window is read
 * here; while the setting is off, nothing is listed at all.
 * Contains keepAnEyeAllowed and startKeepAnEye.
 */

import type { WindowEntry } from '@tagalong/protocol';

/** How often the window titles go to the engine. */
export const KEEP_AN_EYE_INTERVAL_MS = 5_000;

/**
 * Off under fake providers unless a test asks for it, so an end-to-end run never meets a
 * remark it did not set up.
 */
export function keepAnEyeAllowed(env: Record<string, string | undefined>): boolean {
  return env.TAGALONG_FAKE_PROVIDERS !== '1' || env.TAGALONG_KEEP_AN_EYE === '1';
}

/** Starts the timer. Returns the function that stops it. */
export function startKeepAnEye(options: {
  /** Read every tick: the setting and the sight pause change while the app runs. */
  enabled: () => boolean;
  /** Titles only, with the blind spots already marked. */
  list: () => Promise<WindowEntry[]>;
  send: (windows: WindowEntry[]) => Promise<unknown>;
}): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !options.enabled()) return;
    running = true;
    options
      .list()
      .then((windows) => options.send(windows))
      // A paused sight, a failed listing or an engine that is restarting: try next time.
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, KEEP_AN_EYE_INTERVAL_MS);
  return () => clearInterval(timer);
}
