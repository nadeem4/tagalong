/**
 * Scout's voice slots: Ears turn the microphone into words and a Mouth turns an answer into
 * speech. Contains the slot interfaces, the adapter ids and Pushable. Imports nothing, so
 * desktop main, the voice process and the windows all share it.
 */

/** The microphone, as the ears take it: one frame after another until it closes. */
export type MicStream = AsyncIterable<Float32Array>;

export type EarsEvent = 'speechStart' | 'partial' | 'final' | 'turnEnd';

/**
 * `held`: the talk key or the mic button; the turn ends when listening stops. `always`:
 * Always listening; the end-of-turn model decides when the person has finished.
 */
export type ListenMode = 'held' | 'always';

/** Microphone to words; says when you start talking (so Scout stops) and when you have finished. */
export interface Ears {
  listen(mic: MicStream): void;
  stop(): void;
  on(event: EarsEvent, handler: (text?: string) => void): void;
}

export const EARS_IDS = ['local'] as const;

export const MOUTH_IDS = ['kokoro', 'system'] as const;
export type MouthId = (typeof MOUTH_IDS)[number];

/**
 * An async stream fed by pushes, for one reader: frames from the microphone, sentences of
 * a spoken answer. Past `limit` waiting items the oldest is dropped. Pushes after `end`
 * are ignored; items already waiting are still read.
 */
export class Pushable<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #limit: number;
  #waiting: ((result: IteratorResult<T>) => void) | null = null;
  #ended = false;

  constructor(limit = Number.POSITIVE_INFINITY) {
    this.#limit = limit;
  }

  push(item: T): void {
    if (this.#ended) return;
    const waiting = this.#waiting;
    if (waiting !== null) {
      this.#waiting = null;
      waiting({ value: item, done: false });
      return;
    }
    this.#items.push(item);
    if (this.#items.length > this.#limit) this.#items.shift();
  }

  end(): void {
    this.#ended = true;
    const waiting = this.#waiting;
    this.#waiting = null;
    waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.#items.length > 0) {
          return Promise.resolve({ value: this.#items.shift() as T, done: false });
        }
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => {
          this.#waiting = resolve;
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
