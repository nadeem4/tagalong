import { describe, expect, it, vi } from 'vitest';
import { EARS_FRAME } from '@tagalong/protocol';
import { createEarsHost } from './ears-host';
import type { FromWorker } from './messages';

const LOUD = new Float32Array(EARS_FRAME).fill(0.3);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function partsOnce() {
  return vi.fn(async () => ({
    vad: { accept: async (f: Float32Array) => f[0] !== 0 },
    stt: { accept: () => undefined, text: async () => 'hello there', reset: () => undefined },
    turn: { complete: async () => 1 },
  }));
}

describe('createEarsHost', () => {
  it('loads the models once, keeps the first words heard while loading, and posts each event', async () => {
    const posted: FromWorker[] = [];
    const load = partsOnce();
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    await tick();
    host({ kind: 'ears.stop' });
    await tick();
    expect(posted[0]).toEqual({ kind: 'ears.status', status: 'loading' });
    expect(posted).toContainEqual({ kind: 'ears.status', status: 'ready' });
    expect(posted).toContainEqual({ kind: 'ears', event: 'speechStart' });
    expect(posted.at(-1)).toEqual({ kind: 'ears', event: 'turnEnd', text: 'hello there' });

    host({ kind: 'ears.listen', mode: 'held' });
    await tick();
    expect(load).toHaveBeenCalledOnce();
  });

  it('says plainly when the models cannot load, and tries again next time', async () => {
    const posted: FromWorker[] = [];
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(partsOnce());
    const host = createEarsHost({ fake: false, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(posted).toContainEqual({ kind: 'ears.status', status: 'failed', message: 'offline' });
    host({ kind: 'ears.listen', mode: 'always' });
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('uses the fake ears under TAGALONG_FAKE_STT, and loads nothing', async () => {
    const posted: FromWorker[] = [];
    const load = partsOnce();
    const host = createEarsHost({ fake: true, load, post: (m) => posted.push(m) });
    host({ kind: 'ears.listen', mode: 'held' });
    host({ kind: 'ears.frame', samples: LOUD });
    await tick();
    host({ kind: 'ears.stop' });
    expect(load).not.toHaveBeenCalled();
    expect(posted.at(-1)).toEqual({
      kind: 'ears',
      event: 'turnEnd',
      text: 'What am I looking at?',
    });
  });
});
