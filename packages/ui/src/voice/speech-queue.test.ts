/** Tests for SpeechQueue: order, merging, prefetch and stop. */

import { describe, expect, it, vi } from 'vitest';
import { SpeechQueue } from './speech-queue';

/** A player whose lines finish only when the test says so; `prepared` is each synthesis started. */
function controlledPlayer() {
  const prepared: string[] = [];
  const played: string[] = [];
  const pending: { finish: () => void; signal: AbortSignal }[] = [];
  const prepare = (text: string) => {
    prepared.push(text);
    return (signal: AbortSignal): Promise<void> => {
      played.push(text);
      return new Promise<void>((resolve) => {
        pending.push({ finish: resolve, signal });
        signal.addEventListener('abort', () => resolve());
      });
    };
  };
  const finishCurrent = async (): Promise<void> => {
    pending.shift()?.finish();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { prepared, played, pending, prepare, finishCurrent };
}

const LONG_A = 'The first answer is long enough to be spoken entirely on its own.';
const LONG_B = 'The second answer is also long enough to be spoken on its own.';
const LONG_C = 'The third answer is long enough as well, to be spoken on its own.';

describe('SpeechQueue', () => {
  it('speaks one line at a time, in order', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });

    queue.say(LONG_A);
    queue.say(LONG_B);
    expect(player.played).toEqual([LONG_A]);

    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, LONG_B]);
  });

  it('gets the next line ready while the current one plays', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });

    queue.say(LONG_A);
    queue.say(LONG_B);
    expect(player.prepared).toEqual([LONG_A, LONG_B]);
    expect(player.played).toEqual([LONG_A]);

    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, LONG_B]);
    expect(player.prepared).toEqual([LONG_A, LONG_B]);
  });

  it('gets only one line ahead ready, and keeps the order', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });

    queue.say(LONG_A);
    queue.say(LONG_B);
    queue.say(LONG_C);
    expect(player.prepared).toEqual([LONG_A, LONG_B]);

    await player.finishCurrent();
    expect(player.prepared).toEqual([LONG_A, LONG_B, LONG_C]);
    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, LONG_B, LONG_C]);
  });

  it('waits to get a short line ready, so the lines after it can still join it', () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });
    queue.say(LONG_A);
    queue.say('Done.');
    expect(player.prepared).toEqual([LONG_A]);
  });

  it('drops the line it got ready when stopped, and never plays it', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });
    queue.say(LONG_A);
    queue.say(LONG_B);
    expect(player.prepared).toEqual([LONG_A, LONG_B]);

    queue.stop();
    await player.finishCurrent();
    queue.say(LONG_C);
    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, LONG_C]);
  });

  it('shapes what it speaks: no code, no markdown', () => {
    const player = controlledPlayer();
    new SpeechQueue({ prepare: player.prepare }).say('**Fixed.**\n```\ncode\n```');
    expect(player.played).toEqual(['Fixed. The rest is in the bubble.']);
  });

  it('merges short lines waiting together into one', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });
    queue.say(LONG_A);
    queue.say('Done.');
    queue.say('All green.');

    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, 'Done. All green.']);
  });

  it('stops at once: the current line is cut and nothing waiting is spoken', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ prepare: player.prepare });
    queue.say(LONG_A);
    queue.say(LONG_B);

    queue.stop();
    expect(player.pending[0]?.signal.aborted).toBe(true);
    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A]);
  });

  it('says when it starts and stops speaking, for the speaking indicator', async () => {
    const player = controlledPlayer();
    const onSpeaking = vi.fn();
    const queue = new SpeechQueue({ prepare: player.prepare, onSpeaking });

    queue.say(LONG_A);
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    await player.finishCurrent();
    expect(onSpeaking).toHaveBeenLastCalledWith(false);

    queue.say(LONG_B);
    queue.stop();
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
  });

  it('moves on when a line fails to play', async () => {
    const played: string[] = [];
    const queue = new SpeechQueue({
      prepare: (text) => async () => {
        played.push(text);
        if (text === LONG_A) throw new Error('no audio device');
      },
    });
    queue.say(LONG_A);
    queue.say(LONG_B);
    await vi.waitFor(() => expect(played).toEqual([LONG_A, LONG_B]));
  });

  it('ignores a line with nothing to say', () => {
    const player = controlledPlayer();
    new SpeechQueue({ prepare: player.prepare }).say('  ');
    expect(player.played).toEqual([]);
  });

  it('says a whole piece of a spoken answer, without cutting it to two sentences', () => {
    const player = controlledPlayer();
    const piece = 'One thing first. Then another. And a third one, for good measure here.';
    new SpeechQueue({ prepare: player.prepare }).say(piece, { whole: true });
    expect(player.played).toEqual([piece]);
  });
});
