/**
 * The sight pause, enforced at the source: gateSight wraps the platform so every read checks the
 * pause first. Contains gateSight, SIGHT_POLICY, SightPausedError and isSightPaused.
 */

import type { Platform } from './index';

/**
 * Thrown instead of returning nothing, because nothing is what a failure looks like.
 *
 * An empty answer looks exactly like a quiet desktop. A pause that returned an
 * empty capture would be the same mistake with worse consequences: the user would be told
 * the pet cannot see, while every caller that treats emptiness as "nothing to report"
 * carried on as though sight were merely unproductive.
 */
export class SightPausedError extends Error {
  /** Present on the instance so a structural check survives a copied or re-thrown error. */
  readonly sightPaused = true;

  constructor(readonly method: string) {
    super(`sight is paused — ${method} was refused. Press the pause hotkey again to resume.`);
    this.name = 'SightPausedError';
  }
}

/** Whether a caught value is the gate's refusal rather than an ordinary failure. */
export function isSightPaused(error: unknown): error is SightPausedError {
  return error instanceof SightPausedError;
}

/**
 * What pause does to each of the platform's reads.
 *
 * A mapped type over `keyof Platform`, which is the point: adding a method to `Platform`
 * without deciding what pause does to it is a **compile error**, not a hole someone has
 * to notice. Every capture path in the app goes through one of these methods, so a future
 * path cannot forget to consult the pause — there is nothing to remember.
 *
 * `sight` is anything that reads the screen, window titles included: "Re: Q3 layoffs —
 * Outlook" is screen content, and a pet that cannot see the window but can name it has
 * not been paused in any sense the user meant.
 *
 * `handed-over` is the selection and the clipboard. The user highlighted or copied those
 * deliberately, and blinding the pet is not the same as refusing what it is passed — a
 * paused pet is still worth talking to about text you give it.
 */
export const SIGHT_POLICY: { readonly [K in keyof Platform]: 'sight' | 'handed-over' } = {
  getActiveWindow: 'sight',
  captureActiveWindowImage: 'sight',
  captureDisplays: 'sight',
  listWindows: 'sight',
  captureRegion: 'sight',
  readWindowText: 'sight',
  lookAtWindow: 'sight',
  findElement: 'sight',
  captureSelection: 'handed-over',
  readClipboard: 'handed-over',
};

/**
 * Wraps a platform so every screen read is refused while sight is paused.
 *
 * The check runs before the call reaches the adapter, never after. A screenshot taken and
 * then discarded has already been decoded into this process's memory, and the promise
 * pause makes is that those pixels are not read at all — the same promise, and the same
 * ordering, as the capture exclusion list.
 *
 * `isPaused` is read per call rather than captured once, because the gate is built at boot
 * and the user presses the hotkey later.
 */
export function gateSight(platform: Platform, isPaused: () => boolean): Platform {
  const gated = {} as Record<string, unknown>;

  for (const name of Object.keys(SIGHT_POLICY) as Array<keyof Platform>) {
    const method = platform[name] as (...args: unknown[]) => unknown;
    gated[name] =
      SIGHT_POLICY[name] === 'handed-over'
        ? (...args: unknown[]) => method.apply(platform, args)
        : (...args: unknown[]) => {
            if (isPaused()) return Promise.reject(new SightPausedError(name));
            return method.apply(platform, args);
          };
  }

  return gated as unknown as Platform;
}
