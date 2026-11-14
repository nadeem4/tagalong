/** Tests for the speech-model shapes: the brain's stt_state answer and the options Home lists. */
import { describe, expect, it } from 'vitest';
import { finalOptions, formatSize, liveOptions, parseSttState } from './voice-models';
import type { SttState } from './voice-models';

const row = (id: string, label: string, role: string, size_mb: number, gpu = 'none') => ({
  id,
  label,
  role,
  size_mb,
  gpu,
  languages: ['en'],
  note: '',
});

const WIRE = {
  live: 'auto',
  final: 'auto',
  gpu_name: null,
  models: [
    row('moonshine-tiny', 'Moonshine tiny', 'live', 45),
    row('moonshine-small', 'Moonshine small', 'live', 120),
    row('whisper-small-en', 'Whisper small (English)', 'final', 462, 'preferred'),
    row('whisper-large-v3-turbo', 'Whisper large v3 turbo', 'final', 1543, 'required'),
  ],
};

describe('parseSttState', () => {
  it('reads the brain answer, card name included', () => {
    expect(parseSttState({ ...WIRE, gpu_name: 'NVIDIA GeForce RTX 4060' }).gpu_name).toBe(
      'NVIDIA GeForce RTX 4060',
    );
  });

  it('refuses an answer without a model list or choice', () => {
    expect(() => parseSttState({ live: 'auto' })).toThrow();
    expect(() => parseSttState({ ...WIRE, models: [{ id: 'x' }] })).toThrow();
  });
});

describe('formatSize', () => {
  it('shows megabytes under a gigabyte and gigabytes after', () => {
    expect(formatSize(45)).toBe('45 MB');
    expect(formatSize(462)).toBe('462 MB');
    expect(formatSize(1543)).toBe('1.5 GB');
  });
});

describe('liveOptions', () => {
  it('lists Auto first, then only the live models with their sizes', () => {
    expect(liveOptions(parseSttState(WIRE))).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 'moonshine-tiny', label: 'Moonshine tiny · 45 MB' },
      { value: 'moonshine-small', label: 'Moonshine small · 120 MB' },
    ]);
  });
});

describe('finalOptions', () => {
  it('lists Auto, Dont double-check, then the final models', () => {
    const options = finalOptions(parseSttState({ ...WIRE, gpu_name: 'NVIDIA GeForce RTX 4060' }));
    expect(options.map((o) => o.label)).toEqual([
      'Auto',
      "Don't double-check",
      'Whisper small (English) · 462 MB',
      'Whisper large v3 turbo · 1.5 GB',
    ]);
    expect(options[1]?.value).toBe('off');
    expect(options.every((o) => o.disabled !== true)).toBe(true);
  });

  it('marks a model that needs a graphics card when there is none', () => {
    const state: SttState = parseSttState(WIRE);
    const large = finalOptions(state).find((o) => o.value === 'whisper-large-v3-turbo');
    expect(large?.label).toBe('Whisper large v3 turbo · 1.5 GB · Needs a graphics card');
    expect(large?.disabled).toBe(true);
    const small = finalOptions(state).find((o) => o.value === 'whisper-small-en');
    expect(small?.disabled).not.toBe(true);
  });

  it('never prints a now note on Auto', () => {
    expect(finalOptions(parseSttState(WIRE))[0]?.label).toBe('Auto');
  });
});
