/** Tests for the voice service, the lazy local voice and the fake. */

import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '../../shared/settings';
import type { MouthId } from '@tagalong/ui/shapes';
import { LazyLocalVoice, createVoiceService, fakeTts, localMouth, silentWav } from './voice';
import type { LocalSynth, Tts } from './voice';

const SPEED = SETTINGS_DEFAULTS.voice.speed;
const AUDIO = { audio: new Uint8Array([1, 2, 3]), mime: 'audio/wav' };

function tts(name: string, spoken: string[]): Tts {
  return {
    speak: async (text) => {
      spoken.push(`${name}:${text}`);
      return { ...AUDIO, mime: `audio/${name}` };
    },
  };
}

function localVoice(ready: boolean, spoken: string[]) {
  return { ...tts('kokoro', spoken), ready: () => ready, warm: vi.fn() };
}

function service({
  env = {},
  mouth = undefined as MouthId | undefined,
  ready = true,
  spoken = [] as string[],
} = {}) {
  const local = localVoice(ready, spoken);
  const settings = () => ({
    ...SETTINGS_DEFAULTS.voice,
    ...(mouth !== undefined ? { mouth } : {}),
  });
  const voice = createVoiceService({
    env,
    settings,
    local,
    mouths: {
      kokoro: localMouth(local),
    },
  });
  return { voice, local, spoken };
}

describe('createVoiceService', () => {
  it('speaks with the local voice by default', async () => {
    const { voice, spoken } = service();
    expect(await voice.speak('Hello.')).toEqual({ kind: 'audio', ...AUDIO, mime: 'audio/kokoro' });
    expect(spoken).toEqual(['kokoro:Hello.']);
  });

  it('falls back to the system voice while the local model is not ready, and starts loading it', async () => {
    const { voice, local, spoken } = service({ ready: false });
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback', speed: SPEED });
    expect(local.warm).toHaveBeenCalledOnce();
    expect(spoken).toEqual([]);
  });

  it('hands the system voice the saved speed, or the preview speed when one is given', async () => {
    const { voice } = service({ ready: false });
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback', speed: SPEED });
    expect(await voice.speak('Hello.', { speed: 1.3 })).toEqual({ kind: 'fallback', speed: 1.3 });
  });

  it('falls back to the system voice when the local voice fails', async () => {
    const { voice, local } = service();
    local.speak = async () => {
      throw new Error('onnx failed');
    };
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback', speed: SPEED });
  });

  it('never downloads or loads a voice under TAGALONG_FAKE_TTS', async () => {
    const { voice, local, spoken } = service({
      env: { TAGALONG_FAKE_TTS: '1' },
      ready: false,
    });
    const result = await voice.speak('Hi.');
    expect(result.kind).toBe('audio');
    expect(spoken).toEqual([]);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('stays quiet when Scout talks is off, but still plays a preview', async () => {
    const spoken: string[] = [];
    const local = localVoice(true, spoken);
    const voice = createVoiceService({
      env: {},
      settings: () => ({ ...SETTINGS_DEFAULTS.voice, enabled: false }),
      local,
      mouths: {
        kokoro: localMouth(local),
      },
    });
    expect(await voice.speak('Hi.')).toEqual({ kind: 'off' });
    expect((await voice.speak('Preview.', {})).kind).toBe('audio');
    expect(spoken).toEqual(['kokoro:Preview.']);
  });

  it('passes a preview’s voice and speed through to the engine', async () => {
    const seen: unknown[] = [];
    const local = {
      speak: async (_t: string, o: unknown) => (seen.push(o), AUDIO),
      ready: () => true,
      warm: () => {},
    };
    const voice = createVoiceService({
      env: {},
      settings: () => SETTINGS_DEFAULTS.voice,
      local,
      mouths: {
        kokoro: localMouth(local),
      },
    });
    await voice.speak('Hi.', { voice: 'bm_fable', speed: 1.1 });
    await voice.speak('Hi.');
    expect(seen).toEqual([
      { voice: 'bm_fable', speed: 1.1 },
      { voice: 'bm_george', speed: 0.95 },
    ]);
  });

  it('loads an already downloaded local voice at start, so the first lines are not the system voice', () => {
    const { voice, local } = service({ ready: false });
    voice.warmAtStart(true);
    expect(local.warm).toHaveBeenCalledOnce();
  });

  it('never starts a download at start', () => {
    const { voice, local } = service({ ready: false });
    voice.warmAtStart(false);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('loads nothing at start when Scout talks is off or under TAGALONG_FAKE_TTS', () => {
    const fake = service({ ready: false, env: { TAGALONG_FAKE_TTS: '1' } });
    fake.voice.warmAtStart(true);
    expect(fake.local.warm).not.toHaveBeenCalled();

    const local = localVoice(false, []);
    createVoiceService({
      env: {},
      settings: () => ({ ...SETTINGS_DEFAULTS.voice, enabled: false }),
      local,
      mouths: {
        kokoro: localMouth(local),
      },
    }).warmAtStart(true);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('uses the system voice straight away when the person picked it, and never loads Kokoro', async () => {
    const { voice, local, spoken } = service({ mouth: 'system' });
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback', speed: SPEED });
    expect(spoken).toEqual([]);
    expect(local.warm).not.toHaveBeenCalled();
    voice.warmAtStart(true);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('picks a mouth applied from a settings card on the next line, without a restart', async () => {
    const spoken: string[] = [];
    const local = localVoice(true, spoken);
    let voiceSettings: typeof SETTINGS_DEFAULTS.voice & { mouth?: MouthId } = {
      ...SETTINGS_DEFAULTS.voice,
    };
    const voice = createVoiceService({
      env: {},
      settings: () => voiceSettings,
      local,
      mouths: {
        kokoro: localMouth(local),
      },
    });
    expect((await voice.speak('One.')).kind).toBe('audio');
    voiceSettings = { ...voiceSettings, mouth: 'system' };
    expect(await voice.speak('Two.')).toEqual({ kind: 'fallback', speed: SPEED });
    expect(spoken).toEqual(['kokoro:One.']);
  });

  it('a preview with the system voice picked uses it, and never loads Kokoro, even when Kokoro is saved', async () => {
    const { voice, local, spoken } = service({ mouth: 'kokoro' });
    expect(await voice.speak('Hello.', { mouth: 'system' })).toEqual({
      kind: 'fallback',
      speed: SPEED,
    });
    expect(spoken).toEqual([]);
    expect(local.warm).not.toHaveBeenCalled();
  });
});

describe('LazyLocalVoice', () => {
  const synth: LocalSynth = {
    generate: async () => ({ toWav: () => new Uint8Array([9]).buffer }),
  };

  it('says when a warm-up has finished, and whether it loaded', async () => {
    const ok = new LazyLocalVoice(async () => ({
      generate: async () => ({ toWav: () => new ArrayBuffer(0) }),
    }));
    expect(await ok.loaded()).toBe(false);
    ok.warm();
    expect(await ok.loaded()).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = new LazyLocalVoice(async () => {
      throw new Error('download failed');
    });
    broken.warm();
    expect(await broken.loaded()).toBe(false);
    warn.mockRestore();
  });

  it('is not ready until the model has loaded, and loads it once', async () => {
    const load = vi.fn(async () => synth);
    const local = new LazyLocalVoice(load);
    expect(local.ready()).toBe(false);
    local.warm();
    local.warm();
    await vi.waitFor(() => expect(local.ready()).toBe(true));
    expect(load).toHaveBeenCalledOnce();
    expect(await local.speak('Hi.', SETTINGS_DEFAULTS.voice)).toEqual({
      audio: new Uint8Array([9]),
      mime: 'audio/wav',
    });
  });

  it('tries again on the next warm after a failed download', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(synth);
    const local = new LazyLocalVoice(load);
    local.warm();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(local.ready()).toBe(false);
    local.warm();
    await vi.waitFor(() => expect(local.ready()).toBe(true));
  });
});

describe('fakeTts', () => {
  it('returns a short silent WAV', async () => {
    const { audio, mime } = await fakeTts.speak('Hi.', SETTINGS_DEFAULTS.voice);
    expect(mime).toBe('audio/wav');
    expect(new TextDecoder().decode(audio.slice(0, 4))).toBe('RIFF');
    expect(silentWav(100).length).toBeGreaterThan(44);
  });
});
