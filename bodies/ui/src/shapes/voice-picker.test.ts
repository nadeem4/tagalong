/** Tests for the voice picker shape: the brain's tts_state answer, read the way Settings and the tour need it. */
import { describe, expect, it } from 'vitest';
import { parseTtsState } from './voice-picker';

const voice = (id: string, installed = false) => ({
  id,
  label: 'Alan',
  descriptor: 'Warm, British',
  engine: 'piper',
  size_mb: 63,
  licence: 'MIT',
  installed,
  sample: true,
});

const WIRE = {
  chosen: 'auto',
  resolved: 'piper-alan',
  voices: [voice('piper-alan', true), voice('kokoro-bm-george')],
  download: { voice: 'piper-alan', status: 'ready', progress: 1 },
};

describe('parseTtsState', () => {
  it('reads the brain answer', () => {
    const state = parseTtsState(WIRE);
    expect(state.chosen).toBe('auto');
    expect(state.resolved).toBe('piper-alan');
    expect(state.voices.map((v) => v.id)).toEqual(['piper-alan', 'kokoro-bm-george']);
    expect(state.voices[0]?.installed).toBe(true);
    expect(state.download).toEqual({ voice: 'piper-alan', status: 'ready', progress: 1 });
  });

  it('refuses an answer without a voice list', () => {
    const { voices: _voices, ...rest } = WIRE;
    expect(() => parseTtsState(rest)).toThrow();
  });

  it('refuses a voice row that misses a field, or a download that is no state', () => {
    expect(() => parseTtsState({ ...WIRE, voices: [{ id: 'x' }] })).toThrow();
    expect(() =>
      parseTtsState({ ...WIRE, download: { voice: 'x', status: 'stuck', progress: 0 } }),
    ).toThrow();
    expect(() => parseTtsState(null)).toThrow();
  });
});
