import { describe, expect, it, vi } from 'vitest';
import type { FromWorker } from './messages';
import { WorkerLocalVoice } from './worker-local-voice';

function fakeWorker() {
  const listeners: ((m: FromWorker) => void)[] = [];
  const exits: (() => void)[] = [];
  return {
    call: vi.fn(async () => true as unknown),
    onMessage: (l: (m: FromWorker) => void) => (listeners.push(l), () => undefined),
    onExit: (l: () => void) => (exits.push(l), () => undefined),
    tell: (m: FromWorker) => listeners.forEach((l) => l(m)),
    die: () => exits.forEach((l) => l()),
  };
}

describe('WorkerLocalVoice', () => {
  it('is ready once the process says so, and not after the process dies', async () => {
    const worker = fakeWorker();
    const voice = new WorkerLocalVoice(worker);
    expect(voice.ready()).toBe(false);
    worker.tell({ kind: 'kokoro.ready' });
    expect(voice.ready()).toBe(true);
    worker.die();
    expect(voice.ready()).toBe(false);
  });

  it('warms in the process, and speaks there with the voice and speed', async () => {
    const worker = fakeWorker();
    const voice = new WorkerLocalVoice(worker);
    voice.warm();
    await Promise.resolve();
    expect(worker.call).toHaveBeenCalledWith({ kind: 'call', method: 'kokoro.warm' });
    expect(voice.ready()).toBe(true);
    worker.call.mockResolvedValueOnce({ audio: new Uint8Array([9]), mime: 'audio/wav' });
    expect(await voice.speak('Hi.', { voice: 'bm_george', speed: 0.95 })).toEqual({
      audio: new Uint8Array([9]),
      mime: 'audio/wav',
    });
    expect(worker.call).toHaveBeenLastCalledWith({
      kind: 'call',
      method: 'kokoro.speak',
      text: 'Hi.',
      voice: 'bm_george',
      speed: 0.95,
    });
  });
});
