/**
 * The talk key: one key held alone (Right Ctrl unless Settings say otherwise), watched through
 * a key hook because no global shortcut reports a release or binds a lone modifier. Contains
 * KeyHook, TALK_KEYCODES, TalkKeyWatch, startTalkKey and loadKeyHook.
 *
 * Privacy: every key event the hook sees is compared with the talk key's keycode and dropped.
 * Nothing typed is logged, stored or sent; the only thing kept is whether the talk key is down.
 * Nothing is ever typed either: this watches, it sends no input.
 */

import type { TalkKey } from '@tagalong/protocol';
import { TALK_KEY_RIGHT_CTRL } from '@tagalong/protocol';

/** The part of uiohook-napi this module uses, so tests can drive key events by hand. */
export interface KeyHook {
  on(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): void;
  start(): void;
  stop(): void;
}

/** Each talk key's uiohook keycode. */
export const TALK_KEYCODES: { readonly [K in TalkKey]: number } = {
  RightControl: 3613,
  RightAlt: 3640,
  RightShift: 54,
  ScrollLock: 70,
};

export interface TalkKeyHandlers {
  /** The talk key went down. */
  onPress: () => void;
  /** The talk key came up with nothing else pressed while it was held. */
  onRelease: () => void;
  /** Another key went down while it was held: the person meant a shortcut. */
  onCancel: () => void;
}

/**
 * How long the talk key must be held alone before it counts as a talk. A shortcut (Right
 * Ctrl+C) has its second key down well within this, so it never raises the bubble or cuts
 * Scout off; a tap shorter than this is nothing.
 */
export const TALK_CONFIRM_MS = 250;

/** Turns raw key downs and ups into press, release and cancel for the talk key. */
export class TalkKeyWatch {
  readonly #handlers: TalkKeyHandlers;
  #keycode: number = TALK_KEYCODES[TALK_KEY_RIGHT_CTRL];
  /** `waiting`: down, but not yet held alone long enough to be a talk. */
  #mode: 'up' | 'waiting' | 'held' | 'cancelled' = 'up';
  #confirm: ReturnType<typeof setTimeout> | undefined;

  constructor(handlers: TalkKeyHandlers) {
    this.#handlers = handlers;
  }

  /** The talk key from Settings. A change while the old key is held drops that hold. */
  setKey(key: TalkKey): void {
    if (TALK_KEYCODES[key] === this.#keycode) return;
    this.#keycode = TALK_KEYCODES[key];
    this.#reset('up');
  }

  keyDown(keycode: number): void {
    if (keycode === this.#keycode) {
      // Held down, the key repeats: only the first down is a press.
      if (this.#mode !== 'up') return;
      this.#mode = 'waiting';
      this.#confirm = setTimeout(() => {
        this.#mode = 'held';
        this.#handlers.onPress();
      }, TALK_CONFIRM_MS);
    } else if (this.#mode === 'waiting') {
      // A shortcut typed at once: nothing was sent, so there is nothing to cancel.
      this.#reset('cancelled');
    } else if (this.#mode === 'held') {
      this.#mode = 'cancelled';
      this.#handlers.onCancel();
    }
  }

  keyUp(keycode: number): void {
    if (keycode !== this.#keycode) return;
    const was = this.#mode;
    this.#reset('up');
    if (was === 'held') this.#handlers.onRelease();
  }

  #reset(mode: 'up' | 'cancelled'): void {
    clearTimeout(this.#confirm);
    this.#confirm = undefined;
    this.#mode = mode;
  }
}

export interface StartedTalkKey {
  /** Why the talk key could not start, for the hotkey-problem path; null when it is watched. */
  error: string | null;
  /** Stops the hook, for quit. Safe when it never started. */
  stop: () => void;
}

/**
 * Loads and starts the key hook and feeds it into the watch. A hook that will not load or
 * start is one warning and an error to show, never a crash: the mic button still works.
 */
export async function startTalkKey(
  load: () => Promise<KeyHook>,
  watch: TalkKeyWatch,
): Promise<StartedTalkKey> {
  try {
    const hook = await load();
    hook.on('keydown', (event) => watch.keyDown(event.keycode));
    hook.on('keyup', (event) => watch.keyUp(event.keycode));
    hook.start();
    return { error: null, stop: () => hook.stop() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[talk-key] the talk key could not start: ${reason}`);
    return {
      error: `The talk key could not start (${reason}). The mic button in the bubble still works.`,
      stop: () => {},
    };
  }
}

/** The real hook: uiohook-napi, loaded only here so a missing binary is caught. */
export async function loadKeyHook(): Promise<KeyHook> {
  const module = (await import('uiohook-napi')) as {
    uIOhook?: KeyHook;
    default?: { uIOhook?: KeyHook };
  };
  const hook = module.uIOhook ?? module.default?.uIOhook;
  if (hook === undefined) throw new Error('uiohook-napi has no uIOhook');
  return hook;
}
