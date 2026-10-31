/** Tests for the voice adapter facts and chosenMouth. */
import { describe, expect, it } from 'vitest';
import { VOICE_ADAPTERS, adaptersFor, chosenMouth } from './voice';

describe('voice adapters', () => {
  it('lists each adapter once, with plain facts for Settings', () => {
    expect(VOICE_ADAPTERS.map((adapter) => `${adapter.slot}:${adapter.id}`)).toEqual([
      'ears:local',
      'mouth:kokoro',
      'mouth:system',
    ]);
    expect(adaptersFor('mouth').map((adapter) => adapter.label)).toEqual([
      'Kokoro (on the brain)',
      'System voice',
    ]);
    expect(adaptersFor('ears')).toEqual([expect.objectContaining({ id: 'local', offline: true })]);
  });

  it('has only the ears and mouth slots', () => {
    // @ts-expect-error 'live' is not a slot.
    expect(adaptersFor('live')).toEqual([]);
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
