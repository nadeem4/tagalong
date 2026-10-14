import { describe, expect, it, vi } from 'vitest';
import { createWorkerHandler } from './handler';
import type { FromWorker } from './messages';

const AUDIO = { audio: new Uint8Array([1]), mime: 'audio/wav' };

function setup(loaded = true) {
  const posted: FromWorker[] = [];
  const kokoro = {
    warm: vi.fn(),
    loaded: vi.fn(async () => loaded),
    speak: vi.fn(async () => AUDIO),
  };
  const ears = vi.fn();
  const ensureEars = vi.fn(async (onProgress: (fraction: number) => void) => {
    onProgress(0.5);
    onProgress(1);
  });
  const handle = createWorkerHandler({ kokoro, ears, ensureEars }, (m) => posted.push(m));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { posted, kokoro, ears, ensureEars, handle, settle };
}

describe('createWorkerHandler', () => {
  it('warms Kokoro, answers once it has loaded, and says it is ready once', async () => {
    const { posted, kokoro, handle, settle } = setup();
    handle({ kind: 'call', id: 1, method: 'kokoro.warm' });
    handle({ kind: 'call', id: 2, method: 'kokoro.warm' });
    await settle();
    expect(kokoro.warm).toHaveBeenCalledTimes(2);
    expect(posted).toEqual([
      { kind: 'kokoro.ready' },
      { kind: 'result', id: 1, value: true },
      { kind: 'result', id: 2, value: true },
    ]);
  });

  it('speaks a line in the voice and speed asked for', async () => {
    const { posted, kokoro, handle, settle } = setup();
    handle({
      kind: 'call',
      id: 7,
      method: 'kokoro.speak',
      text: 'Hi.',
      voice: 'bm_fable',
      speed: 1,
    });
    await settle();
    expect(kokoro.speak).toHaveBeenCalledWith('Hi.', { voice: 'bm_fable', speed: 1 });
    expect(posted).toContainEqual({ kind: 'result', id: 7, value: AUDIO });
  });

  it('answers a failure as an error with its message, never a silent drop', async () => {
    const { posted, kokoro, handle, settle } = setup();
    kokoro.speak.mockRejectedValueOnce(new Error('not loaded'));
    handle({
      kind: 'call',
      id: 3,
      method: 'kokoro.speak',
      text: 'x',
      voice: 'bm_george',
      speed: 1,
    });
    await settle();
    expect(posted).toEqual([{ kind: 'error', id: 3, message: 'not loaded' }]);
  });

  it('downloads the ears’ models on ears.ensure, posting each fraction, then answers true', async () => {
    const { posted, handle, settle } = setup();
    handle({ kind: 'call', id: 9, method: 'ears.ensure' });
    await settle();
    expect(posted).toEqual([
      { kind: 'ears.progress', fraction: 0.5 },
      { kind: 'ears.progress', fraction: 1 },
      { kind: 'result', id: 9, value: true },
    ]);
  });

  it('answers a failed ears.ensure as an error', async () => {
    const { posted, ensureEars, handle, settle } = setup();
    ensureEars.mockRejectedValueOnce(new Error('offline'));
    handle({ kind: 'call', id: 10, method: 'ears.ensure' });
    await settle();
    expect(posted).toEqual([{ kind: 'error', id: 10, message: 'offline' }]);
  });

  it('passes ears messages to the ears', () => {
    const { ears, handle } = setup();
    handle({ kind: 'ears.stop' });
    expect(ears).toHaveBeenCalledWith({ kind: 'ears.stop' });
  });
});
