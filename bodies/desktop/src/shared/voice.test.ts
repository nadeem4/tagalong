/** Tests for the voice adapter facts, mouth order and chosenMouth. */
import { describe, expect, it } from 'vitest';
import { LOCAL_MOUTH, VOICE_ADAPTERS, adaptersFor, chosenMouth, mouthOrder } from './voice';

describe('voice adapters', () => {
  it('lists each adapter once, with plain facts for Settings', () => {
    expect(VOICE_ADAPTERS.map((adapter) => `${adapter.slot}:${adapter.id}`)).toEqual([
      'ears:local',
      'mouth:kokoro',
      'mouth:system',
    ]);
    expect(adaptersFor('mouth').find((adapter) => adapter.id === 'kokoro')).toMatchObject({
      offline: true,
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
    expect(mouthOrder(LOCAL_MOUTH)).toEqual(['kokoro', 'system']);
    expect(mouthOrder('system')).toEqual(['system', 'kokoro']);
  });
});

describe('chosenMouth', () => {
  it('keeps an explicit choice', () => {
    expect(chosenMouth({ mouth: 'system' })).toBe('system');
  });

  it('defaults to the local voice', () => {
    expect(chosenMouth({})).toBe('kokoro');
  });
});
