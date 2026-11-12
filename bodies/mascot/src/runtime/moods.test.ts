/* Tests for custom moods: which expression a mood plays and which face bits it overrides. */

import { describe, expect, it } from 'vitest';
import { moodExpression, moodFace } from './moods';
import type { CharacterSpec } from '../spec/types';

const spec = {
  moods: { coding: { base: 'working', face: { glow: [1, 0, 0] } }, nap: { base: 'sleeping' } },
} as unknown as CharacterSpec;

describe('moodExpression', () => {
  it('plays a built-in state as itself', () => {
    expect(moodExpression(spec, 'thinking')).toBe('thinking');
  });
  it('plays a custom mood as its base', () => {
    expect(moodExpression(spec, 'coding')).toBe('working');
    expect(moodExpression(spec, 'nap')).toBe('sleeping');
  });
  it('rejects a name that is neither', () => {
    expect(() => moodExpression(spec, 'dancing')).toThrow(/Unknown state "dancing"/);
  });
  it('rejects the poke reaction, which is not a state', () => {
    expect(() => moodExpression(spec, 'happy')).toThrow(/Unknown state/);
  });
});

describe('moodFace', () => {
  it('gives the overrides of a custom mood', () => {
    expect(moodFace(spec, 'coding')).toEqual({ glow: [1, 0, 0] });
  });
  it('gives none for a built-in state or a mood without overrides', () => {
    expect(moodFace(spec, 'idle')).toBeUndefined();
    expect(moodFace(spec, 'nap')).toBeUndefined();
  });
});
