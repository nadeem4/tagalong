/** Tests for installVoiceSeam. */
import { describe, expect, it, vi } from 'vitest';
import { Pushable } from '@tagalong/ui/shapes';
import type { EarsEvent } from '@tagalong/ui/shapes';
import { openMic } from './mic';
import { installVoiceSeam } from './voice-seam';

function fakeTarget() {
  const handlers = new Set<(event: EarsEvent, text?: string) => void>();
  const host = {
    earsListen: vi.fn(async () => undefined),
    micFrame: vi.fn(),
    earsStop: vi.fn(async () => undefined),
    onEarsEvent: vi.fn((handler: (event: EarsEvent, text?: string) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    }),
    ensureEars: vi.fn(async (onProgress: (fraction: number) => void) => onProgress(1)),
  };
  const say = (event: EarsEvent, text?: string) => [...handlers].forEach((h) => h(event, text));
  return { host, say, target: { tagalongHost: host } as unknown as Window };
}

describe('installVoiceSeam', () => {
  it('installs ears, openMic and ensureEars on the window', () => {
    const { target } = fakeTarget();
    installVoiceSeam(target);
    expect(Object.keys(target.tagalongVoice).sort()).toEqual(['ears', 'ensureEars', 'openMic']);
    expect(target.tagalongVoice.openMic).toBe(openMic);
  });

  it('keeps its listeners across questions', async () => {
    const { host, say, target } = fakeTarget();
    installVoiceSeam(target);
    const { ears } = target.tagalongVoice;
    const heard = vi.fn();
    ears.on('turnEnd', heard);
    for (const words of ['one', 'two']) {
      ears.listen(new Pushable<Float32Array>());
      expect(host.earsListen).toHaveBeenCalledWith('held');
      ears.stop();
      say('turnEnd', words);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(heard.mock.calls).toEqual([['one'], ['two']]);
    expect(host.earsStop).toHaveBeenCalledTimes(2);
  });

  it('passes the progress callback through to the host', async () => {
    const { host, target } = fakeTarget();
    installVoiceSeam(target);
    const onProgress = vi.fn();
    await target.tagalongVoice.ensureEars(onProgress);
    expect(host.ensureEars).toHaveBeenCalledWith(onProgress);
    expect(onProgress).toHaveBeenCalledWith(1);
  });
});
