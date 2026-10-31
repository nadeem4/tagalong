/** Tests for toSpeakable and mergeShortLines. */

import { describe, expect, it } from 'vitest';
import { mergeShortLines, toSpeakable } from './speakable';

describe('toSpeakable', () => {
  it('never reads a quoted line, such as a translation into another language', () => {
    expect(toSpeakable('It’s in the bubble.\n> Bonjour.')).toBe('It’s in the bubble.');
  });

  it('says nothing when the answer is only a quote', () => {
    expect(toSpeakable('> Bonjour.\n> Ça va ?')).toBe('');
  });

  it('leaves an answer with no quote as it is', () => {
    expect(toSpeakable('It’s German. Here it is in English: good morning.')).toBe(
      'It’s German. Here it is in English: good morning.',
    );
  });

  it('never reads a quoted line in English either, such as a quoted error', () => {
    expect(
      toSpeakable('The build failed:\n> TypeError: x is undefined\nAn import is missing.'),
    ).toBe('The build failed: An import is missing.');
  });

  it('speaks a short plain answer as it is', () => {
    expect(toSpeakable('The build is green.')).toBe('The build is green.');
  });

  it('strips markdown: emphasis, headings, inline code and links', () => {
    expect(
      toSpeakable('## Result\n**Done.** Run `pnpm test` per [the guide](https://x.dev).'),
    ).toBe('Result Done. Run pnpm test per the guide.');
  });

  it('never reads a code block, and adds nothing about the bubble', () => {
    expect(toSpeakable('Here is the fix.\n```ts\nconst a = 1;\n```')).toBe('Here is the fix.');
  });

  it('never reads a table row', () => {
    expect(toSpeakable('Two prices:\n| a | 1 |\n| b | 2 |')).toBe('Two prices:');
  });

  it('reads a list the mind wrote outside a block, markers stripped', () => {
    expect(toSpeakable('Three things:\n- one\n- two\n- three')).toBe('Three things: one two three');
    expect(toSpeakable('Steps:\n1. open\n2. save')).toBe('Steps: open save');
    expect(toSpeakable('Options:\n• fast\n• slow')).toBe('Options: fast slow');
  });

  it('says every sentence of a long answer: no cap, no pointer to the bubble', () => {
    const answer = 'First. Second one! Third? Fourth. Fifth, and a sixth after it.';
    expect(toSpeakable(answer)).toBe(answer);
    const long = `${'word '.repeat(100)}end.`;
    expect(toSpeakable(long)).toBe(long);
  });

  it('drops bare URLs, which sound like noise', () => {
    expect(toSpeakable('See https://example.com/a/b for details.')).toBe('See for details.');
  });

  it('says nothing when the whole answer is a block', () => {
    expect(toSpeakable('```\nonly code\n```')).toBe('');
  });

  it('says nothing for an empty line', () => {
    expect(toSpeakable('   ')).toBe('');
  });
});

describe('mergeShortLines', () => {
  it('joins consecutive short lines, which the local voice says badly on their own', () => {
    expect(mergeShortLines(['Done.', 'All green.', 'Shall I push?'])).toEqual([
      'Done. All green. Shall I push?',
    ]);
  });

  it('leaves a line long enough to stand alone', () => {
    const long = 'The tests passed on the first run, and the build is ready to ship.';
    expect(mergeShortLines([long, 'Done.'])).toEqual([long, 'Done.']);
  });

  it('keeps an empty queue empty', () => {
    expect(mergeShortLines([])).toEqual([]);
  });
});
