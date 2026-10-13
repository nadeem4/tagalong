import { mergeShortLines, toSpeakable } from './speakable';

export interface SpeechQueueOptions {
  /** Speaks one line, resolving when it has been said or the signal aborts it. */
  play: (text: string, signal: AbortSignal) => Promise<void>;
  /** Fires when Scout starts and stops speaking, for the speaking indicator. */
  onSpeaking?: (speaking: boolean) => void;
}

/**
 * Scout's lines, spoken one at a time. Each line is shaped for speech first; short lines
 * waiting together are merged. `stop` cuts the current line and drops the rest, which is
 * what dismissing the bubble and the stop key do.
 */
export class SpeechQueue {
  readonly #play: SpeechQueueOptions['play'];
  readonly #onSpeaking: (speaking: boolean) => void;
  #waiting: string[] = [];
  #current: AbortController | null = null;
  #speaking = false;

  constructor(options: SpeechQueueOptions) {
    this.#play = options.play;
    this.#onSpeaking = options.onSpeaking ?? (() => undefined);
  }

  say(text: string): void {
    const line = toSpeakable(text);
    if (line === '') return;
    this.#waiting.push(line);
    if (this.#current === null) this.#next();
  }

  stop(): void {
    this.#waiting = [];
    const current = this.#current;
    this.#current = null;
    current?.abort();
    this.#setSpeaking(false);
  }

  #next(): void {
    const [line, ...rest] = mergeShortLines(this.#waiting);
    if (line === undefined) {
      this.#setSpeaking(false);
      return;
    }
    this.#waiting = rest;
    const controller = new AbortController();
    this.#current = controller;
    this.#setSpeaking(true);
    this.#play(line, controller.signal)
      .catch((error: unknown) => console.warn('[voice] a line could not be spoken', error))
      .then(() => {
        if (this.#current !== controller) return;
        this.#current = null;
        this.#next();
      });
  }

  #setSpeaking(speaking: boolean): void {
    if (this.#speaking === speaking) return;
    this.#speaking = speaking;
    this.#onSpeaking(speaking);
  }
}
