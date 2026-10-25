/**
 * Hold-to-talk: decides when the mic starts and stops from the talk key's press and release
 * and the mic button's clicks. Contains PushToTalk, TalkAction and FRESH_PRESS_MS.
 */

/** What the microphone should do after a press, a release or a click. */
export type TalkAction = 'start' | 'stop' | 'none';

/**
 * A press this long after the last one is a new press, not the key repeating while held.
 * Windows waits up to a second before it starts repeating a held key. The desktop's key hook
 * already drops repeats; this still guards a host that does not.
 */
export const FRESH_PRESS_MS = 1100;

/**
 * Talk to Scout's hold-to-talk state. The desktop's key hook reports the talk key going
 * down and coming up, whichever window has the focus. If a release is ever missed, a fresh
 * press stops instead. The mic button toggles: click to talk, click to stop.
 */
export class PushToTalk {
  /** `spent`: listening was ended while the key is still held; its repeats start nothing. */
  #mode: 'idle' | 'held' | 'clicked' | 'spent' = 'idle';
  #lastPress = 0;

  get listening(): boolean {
    return this.#mode === 'held' || this.#mode === 'clicked';
  }

  /** The talk key went down, at `now` milliseconds. */
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

  /** The talk key came up. */
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
