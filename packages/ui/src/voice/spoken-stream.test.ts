import { describe, expect, it } from 'vitest';
import { ONLY_IN_BUBBLE } from './speakable';
import { SpokenStream } from './spoken-stream';

function stream() {
  const said: string[] = [];
  return { said, stream: new SpokenStream((line) => said.push(line)) };
}

describe('SpokenStream', () => {
  it('hands over the first sentence as soon as it is complete, before the answer ends', () => {
    const { said, stream: s } = stream();
    s.push('Sure, it');
    expect(said).toEqual([]);
    s.push('’s a test runner. It');
    expect(said).toEqual(['Sure, it’s a test runner.']);
    s.push('’s set up already.');
    // A full stop at the very end may still be "3." of "3.5": it waits for what follows.
    expect(said).toEqual(['Sure, it’s a test runner.']);
    s.end();
    expect(said).toEqual(['Sure, it’s a test runner.', 'It’s set up already.']);
  });

  it('splits on question marks, exclamations and line breaks', () => {
    const { said, stream: s } = stream();
    s.push('Got it! Want me to open it?\nOr leave it');
    s.end();
    expect(said).toEqual(['Got it!', 'Want me to open it?', 'Or leave it']);
  });

  it('never says code, even when the fence arrives in pieces', () => {
    const { said, stream: s } = stream();
    s.push('Here’s the fix.\n``');
    s.push('`ts\nconst a = 1. b = 2.\n');
    s.push('```\nThat should do it.');
    s.end();
    expect(said).toEqual(['Here’s the fix.', 'That should do it.']);
  });

  it('skips list lines and strips markdown', () => {
    const { said, stream: s } = stream();
    s.push('Two steps, they’re in the bubble.\n- run **pnpm** install\n- run the tests\n');
    s.end();
    expect(said).toEqual(['Two steps, they’re in the bubble.']);
  });

  it('never reads any part of a list item, however its sentences split', () => {
    const { said, stream: s } = stream();
    s.push('Two steps.\n1. Install it. Then wait.\n2. Run ');
    s.push('the tests.\n- Use foo. It is fast.\n• Or bar.\n| a. b. |\nThat’s all.');
    s.end();
    expect(said).toEqual(['Two steps.', 'That’s all.']);
  });

  it('never reads a list item whose marker arrives in pieces', () => {
    const { said, stream: s } = stream();
    s.push('Here.\n1');
    s.push('. Install');
    s.push(' it. Then go.\nDone.');
    s.end();
    expect(said).toEqual(['Here.', 'Done.']);
  });

  it('still reads a line that only starts like a number', () => {
    const { said, stream: s } = stream();
    s.push('3.5 seconds, roughly. ');
    s.push('Fast enough.');
    s.end();
    expect(said).toEqual(['3.5 seconds, roughly.', 'Fast enough.']);
  });

  it('points at the bubble when nothing in the answer could be said', () => {
    const { said, stream: s } = stream();
    s.push('```\ncode only\n```');
    s.end();
    expect(said).toEqual([ONLY_IN_BUBBLE]);
  });

  it('says nothing more after end', () => {
    const { said, stream: s } = stream();
    s.push('Done.');
    s.end();
    s.push(' More.');
    s.end();
    expect(said).toEqual(['Done.']);
  });
});
