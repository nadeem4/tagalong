import { describe, expect, it, vi } from 'vitest';
import { EARS_FRAME, Pushable } from '@tagalong/protocol';
import { GIVE_UP_FRAMES, LocalEars, PAUSE_FRAMES } from './local-ears';
import type { EarsParts } from './local-ears';

const LOUD = new Float32Array(EARS_FRAME).fill(0.3);
const QUIET = new Float32Array(EARS_FRAME);

/** A VAD that hears speech in loud frames; an STT that says one word per loud frame. */
function parts(turnScore: () => Promise<number> = async () => 0.9): EarsParts & { said: string[] } {
  const said: string[] = [];
  let words = 0;
  return {
    said,
    vad: { accept: async (frame) => frame[0] !== 0 },
    stt: {
      accept: (frame) => void (frame[0] !== 0 && (words += 1)),
      text: async () => Array.from({ length: words }, () => 'word').join(' '),
      reset: () => void (words = 0),
    },
    turn: { complete: vi.fn(turnScore) },
  };
}

function hear(mode: 'held' | 'always', p: EarsParts) {
  const ears = new LocalEars(p, mode);
  const events: string[] = [];
  for (const event of ['speechStart', 'partial', 'final', 'turnEnd'] as const)
    ears.on(event, (text) => events.push(text === undefined ? event : `${event}:${text}`));
  const mic = new Pushable<Float32Array>();
  ears.listen(mic);
  const feed = async (frame: Float32Array, times: number) => {
    for (let i = 0; i < times; i += 1) mic.push(frame);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { ears, events, feed, mic };
}

describe('LocalEars, always listening', () => {
  it('says when speech starts, the words as they come, and the turn once the model says it is over', async () => {
    const p = parts();
    const { events, feed } = hear('always', p);
    await feed(QUIET, 3);
    expect(events).toEqual([]);
    await feed(LOUD, 10);
    await feed(QUIET, PAUSE_FRAMES);
    expect(events[0]).toBe('speechStart');
    expect(events).toContain(`partial:${Array(10).fill('word').join(' ')}`);
    expect(events.slice(-2)).toEqual([
      `final:${Array(10).fill('word').join(' ')}`,
      `turnEnd:${Array(10).fill('word').join(' ')}`,
    ]);
  });

  it('waits through a pause the model calls unfinished, and joins both parts in one turn', async () => {
    const scores = [0.1, 0.9];
    const { events, feed } = hear(
      'always',
      parts(async () => scores.shift() ?? 0.9),
    );
    await feed(LOUD, 2);
    await feed(QUIET, PAUSE_FRAMES);
    expect(events.filter((e) => e.startsWith('turnEnd'))).toEqual([]);
    await feed(LOUD, 1);
    await feed(QUIET, PAUSE_FRAMES);
    expect(events.filter((e) => e.startsWith('turnEnd'))).toEqual(['turnEnd:word word word']);
  });

  it('ends the turn after a long silence even when the model never says it is over', async () => {
    const { events, feed } = hear(
      'always',
      parts(async () => 0),
    );
    await feed(LOUD, 2);
    await feed(QUIET, GIVE_UP_FRAMES + PAUSE_FRAMES);
    expect(events).toContain('turnEnd:word word');
  });

  it('treats a failing end-of-turn model as the turn being over', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { events, feed } = hear(
      'always',
      parts(async () => {
        throw new Error('onnx');
      }),
    );
    await feed(LOUD, 1);
    await feed(QUIET, PAUSE_FRAMES);
    expect(events).toContain('turnEnd:word');
    warn.mockRestore();
  });

  it('says nothing more once stopped, and drops a half-heard turn', async () => {
    const { ears, events, feed } = hear('always', parts());
    await feed(LOUD, 3);
    ears.stop();
    await feed(QUIET, PAUSE_FRAMES);
    expect(events.filter((e) => e.startsWith('final') || e.startsWith('turnEnd'))).toEqual([]);
  });
});

describe('LocalEars, held', () => {
  it('waits for stop to end the turn, however long the pauses', async () => {
    const p = parts();
    const { ears, events, feed } = hear('held', p);
    await feed(LOUD, 2);
    await feed(QUIET, GIVE_UP_FRAMES + PAUSE_FRAMES);
    expect(events.filter((e) => e.startsWith('turnEnd'))).toEqual([]);
    ears.stop();
    await feed(QUIET, 0);
    expect(events.at(-1)).toBe('turnEnd:word word');
    expect(p.turn.complete).not.toHaveBeenCalled();
  });

  it('ends with an empty turn when nothing was said, so the bubble can say so', async () => {
    const { ears, events, feed } = hear('held', parts());
    await feed(QUIET, 5);
    ears.stop();
    await feed(QUIET, 0);
    expect(events).toEqual(['turnEnd:']);
  });
});
