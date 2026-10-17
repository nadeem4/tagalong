/**
 * Scout's mouth in a window. A spoken answer streams in and each piece goes to the speech
 * queue whole; a bubble line goes in shortened. `stop` cuts it off and drops whatever is
 * still streaming. Which engine says each line is main's choice (`mouthOrder`).
 * Contains QueueMouth.
 */
import type { Mouth } from '@tagalong/protocol';
import type { SpeechQueue } from './speech-queue';

export class QueueMouth implements Mouth {
  readonly #queue: Pick<SpeechQueue, 'say' | 'stop'>;
  readonly #onAnswering: (answering: boolean) => void;
  #run = 0;
  /** Spoken answers still streaming in this run. */
  #streams = 0;

  /** `onAnswering`: a spoken answer is still streaming in, or none is any more. */
  constructor(
    queue: Pick<SpeechQueue, 'say' | 'stop'>,
    options: { onAnswering?: (answering: boolean) => void } = {},
  ) {
    this.#queue = queue;
    this.#onAnswering = options.onAnswering ?? (() => undefined);
  }

  speak(text: AsyncIterable<string>): void {
    const run = this.#run;
    this.#streams += 1;
    this.#onAnswering(true);
    void (async () => {
      try {
        for await (const piece of text) {
          if (run !== this.#run) return;
          this.#queue.say(piece, { whole: true });
        }
      } catch (error) {
        console.warn('[voice] a spoken answer stopped early', error);
      } finally {
        if (run === this.#run) {
          this.#streams -= 1;
          if (this.#streams === 0) this.#onAnswering(false);
        }
      }
    })();
  }

  say(line: string): void {
    this.#queue.say(line);
  }

  stop(): void {
    this.#run += 1;
    this.#queue.stop();
    this.#streams = 0;
    this.#onAnswering(false);
  }
}
