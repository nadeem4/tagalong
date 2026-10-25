/** FakeEars, for TAGALONG_FAKE_STT=1: fixed words, no model. Used by the end-to-end suites. */

import type { Ears, EarsEvent, ListenMode, MicStream } from '@tagalong/protocol';

/** What the fake hears when held, whatever was said. The end-to-end suite asks this question. */
export const FAKE_TRANSCRIPT = 'What am I looking at?';
/** What the fake hears when always listening: it addresses Scout, as a real turn must. */
export const FAKE_ALWAYS_TRANSCRIPT = 'Scout, what am I looking at?';
/** Always listening: the fake's one turn ends after this many frames. */
export const FAKE_TURN_FRAMES = 20;

/** `TAGALONG_FAKE_STT=1`: ears with no model, fed by Chromium's fake microphone. */
export class FakeEars implements Ears {
  readonly #mode: ListenMode;
  readonly #handlers = new Map<EarsEvent, Set<(text?: string) => void>>();
  #frames = 0;
  #done = false;

  constructor(mode: ListenMode) {
    this.#mode = mode;
  }

  on(event: EarsEvent, handler: (text?: string) => void): void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler);
    this.#handlers.set(event, set);
  }

  listen(mic: MicStream): void {
    void (async () => {
      for await (const _frame of mic) {
        if (this.#done) return;
        this.#frames += 1;
        if (this.#frames === 1) {
          this.#emit('speechStart');
          this.#emit('partial', this.#mode === 'always' ? 'Scout, what am I' : 'What am I');
        }
        if (this.#mode === 'always' && this.#frames === FAKE_TURN_FRAMES) this.#finish();
      }
      // A held mic that ends means listening stopped, as with the local ears.
      if (this.#mode === 'held' && !this.#done) this.#finish();
    })();
  }

  stop(): void {
    if (this.#mode === 'held' && !this.#done) this.#finish();
    this.#done = true;
  }

  #finish(): void {
    this.#done = true;
    const text = this.#mode === 'always' ? FAKE_ALWAYS_TRANSCRIPT : FAKE_TRANSCRIPT;
    this.#emit('final', text);
    this.#emit('turnEnd', text);
  }

  #emit(event: EarsEvent, text?: string): void {
    for (const handler of this.#handlers.get(event) ?? []) handler(text);
  }
}
