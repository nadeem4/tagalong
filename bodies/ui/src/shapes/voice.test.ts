/** Tests for Pushable and the adapter ids. */
import { describe, expect, it } from 'vitest';
import { EARS_IDS, MOUTH_IDS, Pushable } from './voice';

describe('adapter ids', () => {
  it('names the one ears and the two mouths', () => {
    expect(EARS_IDS).toEqual(['local']);
    expect(MOUTH_IDS).toEqual(['kokoro', 'system']);
  });
});

describe('Pushable', () => {
  it('hands items over in order, waiting for ones not pushed yet, until ended', async () => {
    const lines = new Pushable<string>();
    const seen: string[] = [];
    const reading = (async () => {
      for await (const line of lines) seen.push(line);
    })();
    lines.push('one');
    await Promise.resolve();
    lines.push('two');
    lines.end();
    lines.push('ignored');
    await reading;
    expect(seen).toEqual(['one', 'two']);
  });

  it('drops the oldest items past its limit, so a stalled reader cannot grow memory', async () => {
    const frames = new Pushable<number>(2);
    frames.push(1);
    frames.push(2);
    frames.push(3);
    frames.end();
    const seen: number[] = [];
    for await (const frame of frames) seen.push(frame);
    expect(seen).toEqual([2, 3]);
  });
});
