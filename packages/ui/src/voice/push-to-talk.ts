/** What the microphone should do after a press, a release or a click. */
export type TalkAction = 'start' | 'stop' | 'none';

/**
 * A hotkey press this long after the last one is a new press, not the key repeating while
 * held. Windows waits up to a second before it starts repeating a held key.
 */
export const FRESH_PRESS_MS = 1100;

/**
 * Talk to Scout's hold-to-talk state. A global hotkey only reports presses (repeating
 * while held), never the release, so the release comes from the bubble, which has the
 * focus while listening: the first key to come up means the person let go. If that is
 * missed, a fresh press stops instead. The mic button toggles: click to talk, click to stop.
 */
export class PushToTalk {
  #mode: 'idle' | 'held' | 'clicked' = 'idle';
  #lastPress = 0;

  get listening(): boolean {
    return this.#mode !== 'idle';
  }

  /** The hotkey fired, at `now` milliseconds. */
  press(now: number): TalkAction {
    if (this.#mode === 'idle') {
      this.#mode = 'held';
      this.#lastPress = now;
      return 'start';
    }
    if (this.#mode === 'held' && now - this.#lastPress <= FRESH_PRESS_MS) {
      this.#lastPress = now;
      return 'none';
    }
    this.#mode = 'idle';
    return 'stop';
  }

  /** A key came up in the bubble. */
  release(): TalkAction {
    if (this.#mode !== 'held') return 'none';
    this.#mode = 'idle';
    return 'stop';
  }

  /** The mic button. */
  click(): TalkAction {
    if (this.#mode === 'idle') {
      this.#mode = 'clicked';
      return 'start';
    }
    this.#mode = 'idle';
    return 'stop';
  }

  /** Listening ended some other way: the time limit, or the microphone failed. */
  end(): void {
    this.#mode = 'idle';
  }
}
