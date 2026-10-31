/**
 * Scout's lines spoken one at a time, the next one prepared while the current one plays.
 * Contains SpeechQueue, PreparedLine and SpeechQueueOptions.
 */

import { SHORT_LINE, mergeShortLines } from './speakable';
import { SpokenStream } from './spoken-stream';

/** One line's audio, being got ready: playing it resolves when it is said or the signal aborts it. */
type PreparedLine = (signal: AbortSignal) => Promise<void>;

interface SpeechQueueOptions {
  /** Starts getting one line's audio at once, and returns how to play it. */
  prepare: (text: string) => PreparedLine;
  /** Fires when Scout starts and stops speaking, for the speaking indicator. */
  onSpeaking?: (speaking: boolean) => void;
}

/**
 * Scout's lines, spoken one at a time. Each line is shaped for speech first and split into
 * its sentences, so a long answer starts at once and is said in full a sentence at a time;
 * short lines waiting together are merged. The next line is got ready while the current one plays, so
 * there is no pause between them for synthesis; a short one waits, since a line after it
 * may still join it. `stop` cuts the current line and drops the rest, the one got ready
 * included, which is what dismissing the bubble, the stop key and barge-in do.
 */
export class SpeechQueue {
  readonly #prepare: SpeechQueueOptions['prepare'];
  readonly #onSpeaking: (speaking: boolean) => void;
  #waiting: string[] = [];
  #ahead: PreparedLine | null = null;
  #current: AbortController | null = null;
  #speaking = false;

  constructor(options: SpeechQueueOptions) {
    this.#prepare = options.prepare;
    this.#onSpeaking = options.onSpeaking ?? (() => undefined);
  }

  say(text: string): void {
    const lines: string[] = [];
    const sentences = new SpokenStream((line) => lines.push(line));
    sentences.push(text);
    sentences.end();
    if (lines.length === 0) return;
    this.#waiting.push(...lines);
    if (this.#current === null) this.#next();
    else this.#getAheadReady();
  }

  stop(): void {
    this.#waiting = [];
    this.#ahead = null;
    const current = this.#current;
    this.#current = null;
    current?.abort();
    this.#setSpeaking(false);
  }

  /** Takes the next line off the waiting list, unless it is short and could still grow. */
  #take(whenShort: boolean): PreparedLine | null {
    const [line, ...rest] = mergeShortLines(this.#waiting);
    if (line === undefined || (!whenShort && line.length < SHORT_LINE)) return null;
    this.#waiting = rest;
    return this.#prepare(line);
  }

  #getAheadReady(): void {
    this.#ahead ??= this.#take(false);
  }

  #next(): void {
    const line = this.#ahead ?? this.#take(true);
    this.#ahead = null;
    if (line === null) {
      this.#setSpeaking(false);
      return;
    }
    const controller = new AbortController();
    this.#current = controller;
    this.#setSpeaking(true);
    const playing = line(controller.signal);
    this.#getAheadReady();
    playing
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
