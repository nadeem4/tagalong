/** Tests for QueueMouth. */

import { describe, expect, it, vi } from 'vitest';
import { Pushable } from '@tagalong/protocol';
import { QueueMouth } from './mouth';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('QueueMouth', () => {
  it('says each piece of a streamed answer whole, as it arrives', async () => {
    const queue = { say: vi.fn(), stop: vi.fn() };
    const mouth = new QueueMouth(queue);
    const pieces = new Pushable<string>();
    mouth.speak(pieces);
    pieces.push('It checks shutdown.');
    await tick();
    expect(queue.say).toHaveBeenLastCalledWith('It checks shutdown.', { whole: true });
    pieces.push('It is green.');
    pieces.end();
    await tick();
    expect(queue.say).toHaveBeenCalledTimes(2);
  });

  it('stop cuts it off and says nothing more of what is still streaming', async () => {
    const queue = { say: vi.fn(), stop: vi.fn() };
    const mouth = new QueueMouth(queue);
    const pieces = new Pushable<string>();
    mouth.speak(pieces);
    mouth.stop();
    pieces.push('Too late.');
    await tick();
    expect(queue.stop).toHaveBeenCalledOnce();
    expect(queue.say).not.toHaveBeenCalled();
  });

  it('says a bubble line shortened, as before', () => {
    const queue = { say: vi.fn(), stop: vi.fn() };
    new QueueMouth(queue).say('Done.');
    expect(queue.say).toHaveBeenCalledWith('Done.');
  });
});
