import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { MouthId } from '@tagalong/protocol';
import { ELEVENLABS_MODEL, ELEVENLABS_TIMEOUT_MS, elevenLabsTts } from './elevenlabs';
import {
  LazyLocalVoice,
  createVoiceService,
  elevenLabsMouth,
  fakeTts,
  localMouth,
  silentWav,
} from './voice';
import type { LocalSynth, Tts } from './voice';

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
  key = null as string | null,
  voiceId = '',
  mouth = undefined as MouthId | undefined,
  ready = true,
  spoken = [] as string[],
  elevenLabs = (apiKey: string, id: string) => tts(`eleven(${apiKey},${id})`, spoken),
} = {}) {
  const local = localVoice(ready, spoken);
  const settings = () => ({
    ...SETTINGS_DEFAULTS.voice,
    elevenLabsVoiceId: voiceId,
    ...(mouth !== undefined ? { mouth } : {}),
  });
  const voice = createVoiceService({
    env,
    settings,
    local,
    mouths: {
      kokoro: localMouth(local),
      elevenlabs: elevenLabsMouth(
        async () => key,
        () => settings().elevenLabsVoiceId,
        elevenLabs,
      ),
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
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback' });
    expect(local.warm).toHaveBeenCalledOnce();
    expect(spoken).toEqual([]);
  });

  it('falls back to the system voice when the local voice fails', async () => {
    const { voice, local } = service();
    local.speak = async () => {
      throw new Error('onnx failed');
    };
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback' });
  });

  it('uses ElevenLabs only with both a key and a voice the person picked', async () => {
    const keyOnly = service({ key: 'xi-key' });
    await keyOnly.voice.speak('Hi.');
    expect(keyOnly.spoken).toEqual(['kokoro:Hi.']);

    const idOnly = service({ voiceId: 'voice-1' });
    await idOnly.voice.speak('Hi.');
    expect(idOnly.spoken).toEqual(['kokoro:Hi.']);

    const both = service({ key: 'xi-key', voiceId: 'voice-1' });
    await both.voice.speak('Hi.');
    expect(both.spoken).toEqual(['eleven(xi-key,voice-1):Hi.']);
  });

  it('goes back to the local voice when ElevenLabs fails', async () => {
    const { voice, spoken } = service({
      key: 'xi-key',
      voiceId: 'voice-1',
      elevenLabs: () => ({
        speak: async () => {
          throw new Error('401');
        },
      }),
    });
    expect((await voice.speak('Hi.')).kind).toBe('audio');
    expect(spoken).toEqual(['kokoro:Hi.']);
  });

  it('never downloads or calls a service under TAGALONG_FAKE_TTS', async () => {
    const { voice, local, spoken } = service({
      env: { TAGALONG_FAKE_TTS: '1' },
      key: 'xi-key',
      voiceId: 'voice-1',
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
        elevenlabs: elevenLabsMouth(
          async () => null,
          () => '',
          () => tts('eleven', spoken),
        ),
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
        elevenlabs: elevenLabsMouth(
          async () => null,
          () => '',
          () => local,
        ),
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
        elevenlabs: elevenLabsMouth(
          async () => null,
          () => '',
          () => local,
        ),
      },
    }).warmAtStart(true);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('uses the system voice straight away when the person picked it, and never loads Kokoro', async () => {
    const { voice, local, spoken } = service({ mouth: 'system' });
    expect(await voice.speak('Hello.')).toEqual({ kind: 'fallback' });
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
        elevenlabs: elevenLabsMouth(
          async () => null,
          () => '',
          () => tts('eleven', spoken),
        ),
      },
    });
    expect((await voice.speak('One.')).kind).toBe('audio');
    voiceSettings = { ...voiceSettings, mouth: 'system' };
    expect(await voice.speak('Two.')).toEqual({ kind: 'fallback' });
    expect(spoken).toEqual(['kokoro:One.']);
  });

  it('a preview with the system voice picked uses it, and never loads Kokoro, even when Kokoro is saved', async () => {
    const { voice, local, spoken } = service({ mouth: 'kokoro' });
    expect(await voice.speak('Hello.', { mouth: 'system' })).toEqual({ kind: 'fallback' });
    expect(spoken).toEqual([]);
    expect(local.warm).not.toHaveBeenCalled();
  });

  it('falls from a chosen ElevenLabs with no key to Kokoro', async () => {
    const { voice, spoken } = service({ mouth: 'elevenlabs', voiceId: 'voice-1' });
    await voice.speak('Hi.');
    expect(spoken).toEqual(['kokoro:Hi.']);
  });

  it('falls to the system voice when the chosen voice and Kokoro both throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { voice, local } = service({
      key: 'xi-key',
      voiceId: 'voice-1',
      elevenLabs: () => ({
        speak: async () => {
          throw new Error('500');
        },
      }),
    });
    local.speak = async () => {
      throw new Error('onnx failed');
    };
    expect(await voice.speak('Hi.')).toEqual({ kind: 'fallback' });
    warn.mockRestore();
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

describe('elevenLabsTts', () => {
  it('sends only the text, to the low-latency streaming model, with the key in a header', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([7, 7]), { status: 200 }));
    const result = await elevenLabsTts('xi-key', 'voice/1', fetchFn).speak('Hello there.', {
      voice: 'bm_george',
      speed: 0.95,
    });
    expect(result).toEqual({ audio: new Uint8Array([7, 7]), mime: 'audio/mpeg' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice%2F1/stream?output_format=mp3_44100_128',
    );
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi-key');
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'Hello there.',
      model_id: ELEVENLABS_MODEL,
      voice_settings: { speed: 0.95 },
    });
    expect(ELEVENLABS_MODEL).toBe('eleven_flash_v2_5');
  });

  it('throws on a refused request, so the caller can fall back', async () => {
    const fetchFn = async () => new Response('nope', { status: 401 });
    await expect(
      elevenLabsTts('bad', 'v', fetchFn).speak('Hi.', SETTINGS_DEFAULTS.voice),
    ).rejects.toThrow(/401/);
  });

  it('gives up on a request that hangs, so the caller can fall back', async () => {
    const hanging = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    await expect(
      elevenLabsTts('xi-key', 'v', hanging as typeof fetch, 20).speak(
        'Hi.',
        SETTINGS_DEFAULTS.voice,
      ),
    ).rejects.toThrow();
    expect(ELEVENLABS_TIMEOUT_MS).toBe(15_000);
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
