import { ONLY_IN_BUBBLE, toSpeakable } from './speakable';

const FENCE = '```';

/** The end of a sentence that is surely over: its mark and a space after it, or a line break. */
const SENTENCE_END = /[.!?]+["')\]’”]*\s|\n/;

/** A line that is a list item or a table row, judged from its start. */
const LIST_LINE = /^[ \t]*(?:(?:[-*+•]|\d+[.)])\s|\|)/;

/** A line start that could still turn out to be a list marker once more arrives. */
const MAYBE_LIST = /^[ \t]*(?:[-*+•]|\d+[.)]?)?$/;

/**
 * A spoken answer, said sentence by sentence while it streams: the first complete sentence
 * goes to the voice at once rather than after the whole reply. Code blocks and list lines
 * are left to the bubble, whole: a list item is judged by how its line starts, so none of
 * its sentences is read. Markdown is stripped from the rest.
 */
export class SpokenStream {
  readonly #say: (line: string) => void;
  #buffer = '';
  #inCode = false;
  /** The buffer starts a new line, which may be a list item. */
  #lineStart = true;
  /** Inside a list line: everything up to the next line break is dropped. */
  #inList = false;
  #said = false;
  #ended = false;

  constructor(say: (line: string) => void) {
    this.#say = say;
  }

  push(delta: string): void {
    if (this.#ended) return;
    this.#buffer += delta;
    this.#drain(false);
  }

  /** The answer is complete: say what is left, or point at the bubble if nothing was said. */
  end(): void {
    if (this.#ended) return;
    this.#drain(true);
    this.#ended = true;
    if (!this.#said) this.#say(ONLY_IN_BUBBLE);
  }

  #drain(final: boolean): void {
    for (;;) {
      if (this.#inCode) {
        const close = this.#buffer.indexOf(FENCE);
        if (close === -1) {
          // Keep a fence's first backticks, in case the rest of it is still on its way.
          this.#buffer = final ? '' : this.#buffer.slice(-2);
          return;
        }
        this.#buffer = this.#buffer.slice(close + FENCE.length);
        this.#inCode = false;
        continue;
      }
      if (this.#inList) {
        const lineEnd = this.#buffer.indexOf('\n');
        if (lineEnd === -1) {
          this.#buffer = '';
          return;
        }
        this.#buffer = this.#buffer.slice(lineEnd + 1);
        this.#inList = false;
        this.#lineStart = true;
        continue;
      }
      if (this.#lineStart) {
        const firstLine = this.#buffer.split('\n', 1)[0] ?? '';
        if (LIST_LINE.test(firstLine)) {
          this.#inList = true;
          continue;
        }
        // "1" or "-" alone may be a list marker whose rest has not arrived yet.
        if (!final && !this.#buffer.includes('\n') && MAYBE_LIST.test(firstLine)) return;
        this.#lineStart = false;
      }
      const fence = this.#buffer.indexOf(FENCE);
      const match = SENTENCE_END.exec(this.#buffer);
      const end = match === null ? -1 : match.index + match[0].length;
      if (fence !== -1 && (end === -1 || fence < end)) {
        this.#speak(this.#buffer.slice(0, fence));
        this.#buffer = this.#buffer.slice(fence + FENCE.length);
        this.#inCode = true;
        continue;
      }
      if (end !== -1) {
        this.#speak(this.#buffer.slice(0, end));
        this.#buffer = this.#buffer.slice(end);
        if (match?.[0].endsWith('\n') === true) this.#lineStart = true;
        continue;
      }
      if (final) {
        this.#speak(this.#buffer);
        this.#buffer = '';
      }
      return;
    }
  }

  #speak(piece: string): void {
    const line = toSpeakable(piece, { whole: true });
    if (line === '') return;
    this.#said = true;
    this.#say(line);
  }
}
