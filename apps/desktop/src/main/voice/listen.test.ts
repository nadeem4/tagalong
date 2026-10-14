import { describe, expect, it, vi } from 'vitest';
import {
  FAKE_TRANSCRIPT,
  LazyLocalStt,
  SAMPLE_RATE,
  cleanTranscript,
  createListenService,
} from './listen';
import type { LocalStt } from './listen';

/** A second of a quiet tone: speech enough to be worth transcribing. */
function tone(seconds = 1, level = 0.2): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = level * Math.sin(i / 8);
  return samples;
}

function local(text = 'what is this', ready = true): LocalStt & { heard: Float32Array[] } {
  const heard: Float32Array[] = [];
  return {
    heard,
    ready: () => ready,
    warm: vi.fn(),
    transcribe: async (samples) => {
      heard.push(samples);
      return text;
    },
  };
}

describe('createListenService', () => {
  it('turns speech into text on this computer', async () => {
    const stt = local('  What is this?  ');
    const listen = createListenService({ env: {}, local: stt });
    expect(await listen.transcribe(tone())).toEqual({ kind: 'text', text: 'What is this?' });
    expect(stt.heard).toHaveLength(1);
  });

  it('uses the fake under TAGALONG_FAKE_STT=1: no model, no microphone needed', async () => {
    const stt = local();
    const listen = createListenService({ env: { TAGALONG_FAKE_STT: '1' }, local: stt });
    expect(listen.prepare()).toEqual({ ready: true });
    expect(await listen.transcribe(new Float32Array(0))).toEqual({
      kind: 'text',
      text: FAKE_TRANSCRIPT,
    });
    expect(stt.heard).toEqual([]);
    expect(stt.warm).not.toHaveBeenCalled();
  });

  it('starts loading the model when listening starts, and says whether it is ready', () => {
    const stt = local('x', false);
    const listen = createListenService({ env: {}, local: stt });
    expect(listen.prepare()).toEqual({ ready: false });
    expect(stt.warm).toHaveBeenCalledOnce();
  });

  it('hears nothing in silence or a click too short to be a word, and never asks the model', async () => {
    const stt = local();
    const listen = createListenService({ env: {}, local: stt });
    expect(await listen.transcribe(tone(1, 0))).toEqual({ kind: 'text', text: '' });
    expect(await listen.transcribe(tone(0.1))).toEqual({ kind: 'text', text: '' });
    expect(stt.heard).toEqual([]);
  });

  it('reports a model that failed instead of throwing', async () => {
    const stt = local();
    stt.transcribe = async () => {
      throw new Error('onnx failed');
    };
    const listen = createListenService({ env: {}, local: stt });
    expect(await listen.transcribe(tone())).toEqual({
      kind: 'failed',
      message: 'Speech could not be turned into text: onnx failed',
    });
  });
});

describe('cleanTranscript', () => {
  it('drops the markers Whisper writes for silence and noise', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanTranscript('(music) Open the readme.')).toBe('Open the readme.');
  });
});

describe('LazyLocalStt', () => {
  it('loads the model once, on first use, and waits for it before transcribing', async () => {
    const load = vi.fn(async () => async () => 'hello');
    const stt = new LazyLocalStt(load);
    expect(stt.ready()).toBe(false);
    stt.warm();
    stt.warm();
    expect(await stt.transcribe(tone())).toBe('hello');
    expect(await stt.transcribe(tone())).toBe('hello');
    expect(load).toHaveBeenCalledOnce();
    expect(stt.ready()).toBe(true);
  });

  it('tries the download again after it failed', async () => {
    const load = vi
      .fn<() => Promise<(samples: Float32Array) => Promise<string>>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(async () => 'again');
    const stt = new LazyLocalStt(load);
    await expect(stt.transcribe(tone())).rejects.toThrow('offline');
    expect(await stt.transcribe(tone())).toBe('again');
  });
});
