import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMic } from './mic';

/** A microphone and an audio graph that fails at `failAt`, in plain Node. */
function fakeAudio(failAt: 'context' | 'worklet' | 'node') {
  const stop = vi.fn();
  const close = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = {
        addModule: async () => {
          if (failAt === 'worklet') throw new Error('worklet blocked');
        },
      };
      destination = {};
      constructor() {
        if (failAt === 'context') throw new Error('no audio device');
      }
      close = close;
      createMediaStreamSource = () => ({ connect: (next: unknown) => next });
      createGain = () => ({ gain: { value: 1 }, connect: (next: unknown) => next });
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null };
      constructor() {
        if (failAt === 'node') throw new Error('no processor');
      }
      connect = (next: unknown) => next;
    },
  );
  return { stop, close };
}

afterEach(() => vi.unstubAllGlobals());

describe('openMic', () => {
  it.each([
    ['worklet', 'worklet blocked'],
    ['node', 'no processor'],
  ] as const)(
    'stops the microphone and closes the audio when the %s fails',
    async (at, message) => {
      const { stop, close } = fakeAudio(at);
      await expect(openMic()).rejects.toThrow(message);
      expect(stop).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('stops the microphone when the audio cannot start at all', async () => {
    const { stop } = fakeAudio('context');
    await expect(openMic()).rejects.toThrow('no audio device');
    expect(stop).toHaveBeenCalledOnce();
  });
});
