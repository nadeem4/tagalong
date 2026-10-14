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
  /** `spent`: listening was ended while the key is still held; its repeats start nothing. */
  #mode: 'idle' | 'held' | 'clicked' | 'spent' = 'idle';
  #lastPress = 0;

  get listening(): boolean {
    return this.#mode === 'held' || this.#mode === 'clicked';
  }

  /** The hotkey fired, at `now` milliseconds. */
  press(now: number): TalkAction {
    if (this.#mode === 'spent' && now - this.#lastPress <= FRESH_PRESS_MS) {
      this.#lastPress = now;
      return 'none';
    }
    if (this.#mode === 'idle' || this.#mode === 'spent') {
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
    if (this.#mode === 'spent') this.#mode = 'idle';
    if (this.#mode !== 'held') return 'none';
    this.#mode = 'idle';
    return 'stop';
  }

  /** The mic button. */
  click(): TalkAction {
    if (this.#mode === 'idle' || this.#mode === 'spent') {
      this.#mode = 'clicked';
      return 'start';
    }
    this.#mode = 'idle';
    return 'stop';
  }

  /**
   * Listening ended some other way: the time limit, the microphone or the ears failed. A key
   * still held keeps repeating: those repeats start nothing until it comes up or a fresh press.
   */
  end(): void {
    this.#mode = this.#mode === 'held' ? 'spent' : 'idle';
  }
}
