import { describe, expect, it } from 'vitest';
import { ONLY_IN_BUBBLE, REST_IN_BUBBLE, mergeShortLines, toSpeakable } from './speakable';

describe('toSpeakable', () => {
  it('never reads a quoted line, such as a translation into another language', () => {
    expect(toSpeakable('It’s in the bubble.\n> Bonjour.')).toBe('It’s in the bubble.');
  });

  it('points at the bubble when the answer is only a quote', () => {
    expect(toSpeakable('> Bonjour.\n> Ça va ?')).toBe(ONLY_IN_BUBBLE);
  });

  it('leaves an answer with no quote as it is', () => {
    expect(toSpeakable('It’s German. Here it is in English: good morning.')).toBe(
      'It’s German. Here it is in English: good morning.',
    );
  });

  it('never reads a quoted line in a whole spoken piece', () => {
    expect(toSpeakable('> Bonjour.', { whole: true })).toBe('');
  });

  it('speaks a short plain answer as it is', () => {
    expect(toSpeakable('The build is green.')).toBe('The build is green.');
  });

  it('strips markdown: emphasis, headings, inline code and links', () => {
    expect(
      toSpeakable('## Result\n**Done.** Run `pnpm test` per [the guide](https://x.dev).'),
    ).toBe('Result Done. Run pnpm test per the guide.');
  });

  it('never reads a code block, and says where the rest is', () => {
    expect(toSpeakable('Here is the fix.\n```ts\nconst a = 1;\n```')).toBe(
      `Here is the fix. ${REST_IN_BUBBLE}`,
    );
  });

  it('never reads a draft block', () => {
    const spoken = toSpeakable(
      "Here's a draft. Copy it and paste it in.\n\n```draft\nHi Sam,\n\nYes, Friday works.\n```",
    );
    expect(spoken).not.toContain('Friday');
    expect(spoken).toContain("Here's a draft.");
  });

  it('never reads a list, and says where the rest is', () => {
    expect(toSpeakable('Three things:\n- one\n- two\n- three')).toBe(
      `Three things: ${REST_IN_BUBBLE}`,
    );
    expect(toSpeakable('Steps:\n1. open\n2. save')).toBe(`Steps: ${REST_IN_BUBBLE}`);
    expect(toSpeakable('Options:\n• fast\n• slow')).toBe(`Options: ${REST_IN_BUBBLE}`);
  });

  it('speaks the first two sentences of a long answer, then points at the bubble', () => {
    expect(toSpeakable('First. Second one! Third? Fourth.')).toBe(
      `First. Second one! ${REST_IN_BUBBLE}`,
    );
  });

  it('cuts one very long sentence at a word, not mid-word', () => {
    const spoken = toSpeakable(`${'word '.repeat(100)}end.`);
    expect(spoken.endsWith(REST_IN_BUBBLE)).toBe(true);
    expect(spoken.length).toBeLessThan(260);
    expect(spoken).not.toMatch(/wor\s/);
  });

  it('drops bare URLs, which sound like noise', () => {
    expect(toSpeakable('See https://example.com/a/b for details.')).toBe('See for details.');
  });

  it('says only where to look when nothing in the answer can be spoken', () => {
    expect(toSpeakable('```\nonly code\n```')).toBe('The answer is in the bubble.');
  });

  it('says nothing for an empty line', () => {
    expect(toSpeakable('   ')).toBe('');
  });
});

describe('toSpeakable, whole', () => {
  it('says every sentence of a spoken answer, with no cut and no pointer to the bubble', () => {
    const answer = 'It’s a test runner. It’s already set up. You just run it. Want me to?';
    expect(toSpeakable(answer, { whole: true })).toBe(answer);
  });

  it('still strips markdown, and says nothing for a piece that is all code or list', () => {
    expect(toSpeakable('**Sure.** Run `pnpm test`.', { whole: true })).toBe('Sure. Run pnpm test.');
    expect(toSpeakable('- first item', { whole: true })).toBe('');
    expect(toSpeakable('```\nconst a = 1;\n```', { whole: true })).toBe('');
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
