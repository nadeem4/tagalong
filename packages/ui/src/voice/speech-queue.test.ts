import { describe, expect, it, vi } from 'vitest';
import { SpeechQueue } from './speech-queue';

/** A player whose lines finish only when the test says so. */
function controlledPlayer() {
  const played: string[] = [];
  const pending: { finish: () => void; signal: AbortSignal }[] = [];
  const play = (text: string, signal: AbortSignal): Promise<void> => {
    played.push(text);
    return new Promise<void>((resolve) => {
      pending.push({ finish: resolve, signal });
      signal.addEventListener('abort', () => resolve());
    });
  };
  const finishCurrent = async (): Promise<void> => {
    pending.shift()?.finish();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { played, pending, play, finishCurrent };
}

const LONG_A = 'The first answer is long enough to be spoken entirely on its own.';
const LONG_B = 'The second answer is also long enough to be spoken on its own.';

describe('SpeechQueue', () => {
  it('speaks one line at a time, in order', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ play: player.play });

    queue.say(LONG_A);
    queue.say(LONG_B);
    expect(player.played).toEqual([LONG_A]);

    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, LONG_B]);
  });

  it('shapes what it speaks: no code, no markdown', () => {
    const player = controlledPlayer();
    new SpeechQueue({ play: player.play }).say('**Fixed.**\n```\ncode\n```');
    expect(player.played).toEqual(['Fixed. The rest is in the bubble.']);
  });

  it('merges short lines waiting together into one', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ play: player.play });
    queue.say(LONG_A);
    queue.say('Done.');
    queue.say('All green.');

    await player.finishCurrent();
    expect(player.played).toEqual([LONG_A, 'Done. All green.']);
  });

  it('stops at once: the current line is cut and nothing waiting is spoken', async () => {
    const player = controlledPlayer();
    const queue = new SpeechQueue({ play: player.play });
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
    const queue = new SpeechQueue({ play: player.play, onSpeaking });

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
      play: async (text) => {
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
    new SpeechQueue({ play: player.play }).say('  ');
    expect(player.played).toEqual([]);
  });

  it('says a whole piece of a spoken answer, without cutting it to two sentences', () => {
    const player = controlledPlayer();
    const piece = 'One thing first. Then another. And a third one, for good measure here.';
    new SpeechQueue({ play: player.play }).say(piece, { whole: true });
    expect(player.played).toEqual([piece]);
  });
});
