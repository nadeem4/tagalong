/**
 * A spoken answer said sentence by sentence while it streams, leaving show-only blocks to
 * the bubble. Contains SpokenStream.
 */

import { toSpeakable } from './speakable';

const FENCE = '```';

/** The end of a sentence that is surely over: its mark and a space after it, or a line break. */
const SENTENCE_END = /[.!?]+["')\]’”]*\s|\n/;

/**
 * A show-only line, judged from its start: a table row or a quote. A quote holds a
 * translation into another language, which the English voice would mangle.
 */
const SHOW_LINE = /^[ \t]*(?:\||>)/;

/** A list item's marker, dropped so the item itself is read. */
const LIST_MARKER = /^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/;

/** A line start that could still turn out to be a list marker once more arrives. */
const MAYBE_LIST = /^[ \t]*(?:[-*+•]|\d+[.)]?)?$/;

/**
 * A spoken answer, said sentence by sentence while it streams: the first complete sentence
 * goes to the voice at once rather than after the whole reply. Everything is said except
 * show-only blocks: fenced blocks (a draft, code), table rows and quoted (`>`) lines, each
 * judged by how its line starts, so none of its sentences is read. A list item is read
 * without its marker. Markdown is stripped from the rest; nothing is cut or added.
 */
export class SpokenStream {
  readonly #say: (line: string) => void;
  #buffer = '';
  #inCode = false;
  /** The buffer starts a new line, which may be a list item. */
  #lineStart = true;
  /** Inside a show-only line: everything up to the next line break is dropped. */
  #inShowLine = false;
  #ended = false;

  constructor(say: (line: string) => void) {
    this.#say = say;
  }

  push(delta: string): void {
    if (this.#ended) return;
    this.#buffer += delta;
    this.#drain(false);
  }

  /** The answer is complete: say what is left. */
  end(): void {
    if (this.#ended) return;
    this.#drain(true);
    this.#ended = true;
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
      if (this.#inShowLine) {
        const lineEnd = this.#buffer.indexOf('\n');
        if (lineEnd === -1) {
          this.#buffer = '';
          return;
        }
        this.#buffer = this.#buffer.slice(lineEnd + 1);
        this.#inShowLine = false;
        this.#lineStart = true;
        continue;
      }
      if (this.#lineStart) {
        const firstLine = this.#buffer.split('\n', 1)[0] ?? '';
        if (SHOW_LINE.test(firstLine)) {
          this.#inShowLine = true;
          continue;
        }
        // "1" or "-" alone may be a list marker whose rest has not arrived yet.
        if (!final && !this.#buffer.includes('\n') && MAYBE_LIST.test(firstLine)) return;
        this.#buffer = this.#buffer.replace(LIST_MARKER, '');
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
    const line = toSpeakable(piece);
    if (line !== '') this.#say(line);
  }
}
