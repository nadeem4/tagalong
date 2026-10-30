/** Tests for the voice adapter facts, mouth order and chosenMouth. */
import { describe, expect, it } from 'vitest';
import { LOCAL_MOUTH, VOICE_ADAPTERS, adaptersFor, chosenMouth, mouthOrder } from './voice';

describe('voice adapters', () => {
  it('lists each adapter once, with plain facts for Settings', () => {
    expect(VOICE_ADAPTERS.map((adapter) => `${adapter.slot}:${adapter.id}`)).toEqual([
      'ears:local',
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
    expect(adaptersFor('ears')).toEqual([expect.objectContaining({ id: 'local', offline: true })]);
  });

  it('has only the ears and mouth slots', () => {
    // @ts-expect-error 'live' is not a slot.
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
