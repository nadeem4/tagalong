import { describe, expect, it } from 'vitest';
import {
  LOCAL_MOUTH,
  Pushable,
  VOICE_ADAPTERS,
  adaptersFor,
  chosenMouth,
  mouthOrder,
} from './voice';

describe('voice adapters', () => {
  it('lists each adapter once, with plain facts for Settings', () => {
    expect(VOICE_ADAPTERS.map((adapter) => `${adapter.slot}:${adapter.id}`)).toEqual([
      'ears:sherpa',
      'mouth:kokoro',
      'mouth:elevenlabs',
      'mouth:system',
    ]);
    expect(adaptersFor('mouth').find((adapter) => adapter.id === 'elevenlabs')).toMatchObject({
      offline: false,
      needsKey: true,
      costs: true,
      screenshots: false,
    });
    expect(adaptersFor('ears')).toEqual([expect.objectContaining({ id: 'sherpa', offline: true })]);
  });

  it('has a Live slot but no Live adapter yet', () => {
    expect(adaptersFor('live')).toEqual([]);
  });
});

describe('mouthOrder', () => {
  it('tries the chosen voice, then the local one, then the system voice', () => {
    expect(mouthOrder('elevenlabs')).toEqual(['elevenlabs', 'kokoro', 'system']);
    expect(mouthOrder(LOCAL_MOUTH)).toEqual(['kokoro', 'system']);
    expect(mouthOrder('system')).toEqual(['system', 'kokoro']);
  });
});

describe('chosenMouth', () => {
  it('keeps an explicit choice', () => {
    expect(chosenMouth({ mouth: 'system', elevenLabsVoiceId: 'v1' })).toBe('system');
  });

  it('keeps ElevenLabs for a settings file from before the picker that had a voice set', () => {
    expect(chosenMouth({ elevenLabsVoiceId: 'v1' })).toBe('elevenlabs');
    expect(chosenMouth({ elevenLabsVoiceId: '' })).toBe('kokoro');
  });
});

describe('Pushable', () => {
  it('hands items over in order, waiting for ones not pushed yet, until ended', async () => {
    const lines = new Pushable<string>();
    const seen: string[] = [];
    const reading = (async () => {
      for await (const line of lines) seen.push(line);
    })();
    lines.push('one');
    await Promise.resolve();
    lines.push('two');
    lines.end();
    lines.push('ignored');
    await reading;
    expect(seen).toEqual(['one', 'two']);
  });

  it('drops the oldest items past its limit, so a stalled reader cannot grow memory', async () => {
    const frames = new Pushable<number>(2);
    frames.push(1);
    frames.push(2);
    frames.push(3);
    frames.end();
    const seen: number[] = [];
    for await (const frame of frames) seen.push(frame);
    expect(seen).toEqual([2, 3]);
  });
});
