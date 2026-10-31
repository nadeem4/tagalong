/** Tests for SpokenStream: sentence-by-sentence speech while streaming. */

import { describe, expect, it } from 'vitest';
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

  it('never says a fenced block, even when it arrives in pieces', () => {
    const { said, stream: s } = stream();
    s.push("Here's the fix.\n``");
    s.push('`ts\nconst a = 1; const b = 2.\n');
    s.push('Thanks!\n``');
    s.push('`');
    s.end();
    expect(said).toEqual(["Here's the fix."]);
  });

  it('reads a list the mind wrote outside a block, markers and markdown stripped', () => {
    const { said, stream: s } = stream();
    s.push('Two steps.\n- run **pnpm** install\n- run the tests\n');
    s.end();
    expect(said).toEqual(['Two steps.', 'run pnpm install', 'run the tests']);
  });

  it('reads every sentence of a list item, never its marker; a table row is never read', () => {
    const { said, stream: s } = stream();
    s.push('Two steps.\n1. Install it. Then wait.\n2. Run ');
    s.push('the tests.\n• Or bar.\n| a. b. |\nThat’s all.');
    s.end();
    expect(said).toEqual([
      'Two steps.',
      'Install it.',
      'Then wait.',
      'Run the tests.',
      'Or bar.',
      'That’s all.',
    ]);
  });

  it('drops a list marker that arrives in pieces', () => {
    const { said, stream: s } = stream();
    s.push('Here.\n1');
    s.push('. Install');
    s.push(' it. Then go.\nDone.');
    s.end();
    expect(said).toEqual(['Here.', 'Install it.', 'Then go.', 'Done.']);
  });

  it('says every sentence of a long answer, with no cap', () => {
    const { said, stream: s } = stream();
    s.push('One. Two. Three. Four. Five. Six.');
    s.end();
    expect(said).toEqual(['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.']);
  });

  it('still reads a line that only starts like a number', () => {
    const { said, stream: s } = stream();
    s.push('3.5 seconds, roughly. ');
    s.push('Fast enough.');
    s.end();
    expect(said).toEqual(['3.5 seconds, roughly.', 'Fast enough.']);
  });

  it('says nothing when the whole answer is a block', () => {
    const { said, stream: s } = stream();
    s.push('```\ncode only\n```');
    s.end();
    expect(said).toEqual([]);
  });

  it('never says a quoted line, even when the > arrives alone, and says the lines after it', () => {
    const { said, stream: s } = stream();
    s.push('It’s in the bubble.\n');
    s.push('>');
    s.push(' Bonjour. Ça va ?');
    s.push(' Très bien.\n> Merci.\nThat’s');
    s.push(' all of it.');
    s.end();
    expect(said).toEqual(['It’s in the bubble.', 'That’s all of it.']);
  });

  it('never says a quoted English line either, such as a quoted error', () => {
    const { said, stream: s } = stream();
    s.push('The build failed.\n> TypeError: x is undefined\nAn import is missing.');
    s.end();
    expect(said).toEqual(['The build failed.', 'An import is missing.']);
  });

  it('says nothing when the whole answer is a quote', () => {
    const { said, stream: s } = stream();
    s.push('> Bonjour.\n> Merci.');
    s.end();
    expect(said).toEqual([]);
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
