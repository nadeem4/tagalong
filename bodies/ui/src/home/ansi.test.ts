/** Tests for the SGR-only ANSI parser and the carriage-return collapse used by the job log. */

import { describe, expect, it } from 'vitest';
import { collapseCarriageReturns, parseAnsi } from './ansi';

describe('parseAnsi', () => {
  it('returns plain text as one span with no colour', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', bold: false, color: null }]);
  });

  it('colours text and resets', () => {
    expect(parseAnsi('\x1b[31mred\x1b[0m ok')).toEqual([
      { text: 'red', bold: false, color: 'red' },
      { text: ' ok', bold: false, color: null },
    ]);
  });

  it('reads bold and colour in one sequence', () => {
    expect(parseAnsi('\x1b[1;32mgo')).toEqual([{ text: 'go', bold: true, color: 'green' }]);
  });

  it('maps bright colours', () => {
    expect(parseAnsi('\x1b[91mx')[0]?.color).toBe('brightRed');
  });

  it('resets only the colour on 39', () => {
    expect(parseAnsi('\x1b[1;31ma\x1b[39mb')).toEqual([
      { text: 'a', bold: true, color: 'red' },
      { text: 'b', bold: true, color: null },
    ]);
  });

  it('strips cursor moves, clears, private modes and OSC', () => {
    expect(parseAnsi('\x1b[2Ka\x1b[1Ab\x1b[?25lc\x1b]0;title\x07d')).toEqual([
      { text: 'abcd', bold: false, color: null },
    ]);
  });

  it('ignores unknown SGR codes without throwing', () => {
    expect(parseAnsi('\x1b[38;5;200mx')).toEqual([{ text: 'x', bold: false, color: null }]);
  });

  it('parses 64 KB of mixed codes quickly', () => {
    const text = '\x1b[31mabcdefghij\x1b[0m\r'.repeat(3000);
    const started = performance.now();
    parseAnsi(text);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('collapseCarriageReturns', () => {
  it('keeps the last state of a progress line', () => {
    expect(collapseCarriageReturns('10%\r50%\r100%\nnext')).toBe('100%\nnext');
  });

  it('keeps CRLF as a newline', () => {
    expect(collapseCarriageReturns('a\r\nb')).toBe('a\nb');
  });
});

describe('parseAnsi escapes', () => {
  const plain = (t: string) =>
    parseAnsi(t)
      .map((s) => s.text)
      .join('');

  it('strips charset selects like tput sgr0 emits', () => {
    expect(plain('a\x1b(Bb')).toBe('ab');
  });

  it('strips ST-terminated OSC 8 links and keeps the link text', () => {
    expect(plain('\x1b]8;;http://x.test\x1b\\link\x1b]8;;\x1b\\ done')).toBe('link done');
  });

  it('does not let an unterminated OSC eat later text', () => {
    expect(plain('a\x1b]0;title\x1b[31mred')).toBe('ared');
  });

  it('strips colon and private-mode parameters without reading them as colour', () => {
    expect(parseAnsi('\x1b[38:5:200mx\x1b[>4;2my')).toEqual([
      { text: 'xy', bold: false, color: null },
    ]);
  });

  it('drops a lone escape', () => {
    expect(plain('a\x1b\nb')).toBe('a\nb');
  });

  it('parses 32k unterminated OSC starts quickly', () => {
    const start = performance.now();
    parseAnsi('\x1b]'.repeat(32_000));
    expect(performance.now() - start).toBeLessThan(200);
  });
});
