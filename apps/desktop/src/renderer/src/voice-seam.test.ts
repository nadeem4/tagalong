import { describe, expect, it, vi } from 'vitest';
import { openMic } from './mic';
import { RemoteEars } from './remote-ears';
import { installVoiceSeam } from './voice-seam';

function fakeTarget() {
  const host = {
    earsListen: vi.fn(async () => undefined),
    micFrame: vi.fn(),
    earsStop: vi.fn(async () => undefined),
    onEarsEvent: vi.fn(() => () => undefined),
    ensureEars: vi.fn(async (onProgress: (fraction: number) => void) => onProgress(1)),
  };
  return { host, target: { tagalongHost: host } as unknown as Window };
}

describe('installVoiceSeam', () => {
  it('installs ears, openMic and ensureEars on the window', () => {
    const { target } = fakeTarget();
    installVoiceSeam(target);
    expect(Object.keys(target.tagalongVoice).sort()).toEqual(['ears', 'ensureEars', 'openMic']);
    expect(target.tagalongVoice.ears).toBeInstanceOf(RemoteEars);
    expect(target.tagalongVoice.openMic).toBe(openMic);
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
