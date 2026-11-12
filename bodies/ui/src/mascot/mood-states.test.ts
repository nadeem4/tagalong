/** Tests for the dock-mood to engine-mood map and for Scout's spec (props shown per mood). */
import { describe, expect, it } from 'vitest';
import { STATES, compile } from '@tagalong/mascot';
import { DOCK_MOODS } from '../dock-pet';
import { MOOD_STATE } from './mood-states';
import { scout } from './scout';

describe('MOOD_STATE', () => {
  it('names an engine mood for each of the twelve dock moods', () => {
    expect(DOCK_MOODS).toHaveLength(12);
    for (const mood of DOCK_MOODS) expect(typeof MOOD_STATE[mood]).toBe('string');
  });

  it('plays the engine state of the same name, except dozing (sleeping)', () => {
    for (const mood of DOCK_MOODS) {
      expect(MOOD_STATE[mood]).toBe(mood === 'dozing' ? 'sleeping' : mood);
    }
  });

  it('only uses moods the engine knows or Scout defines', () => {
    const known = new Set<string>([...STATES, ...Object.keys(scout.moods ?? {})]);
    for (const mood of DOCK_MOODS) expect(known.has(MOOD_STATE[mood])).toBe(true);
  });
});

describe('scout', () => {
  it('defines reading as a custom mood on listening', () => {
    expect(scout.moods?.reading?.base).toBe('listening');
  });

  it('compiles (every prop mood and bone resolves)', () => {
    expect(() => compile(scout)).not.toThrow();
  });

  it('shows each prop only in its own moods', () => {
    const shown = new Set<string>();
    for (const part of scout.parts) for (const m of part.moods ?? []) shown.add(m);
    expect([...shown].sort()).toEqual(
      ['celebrating', 'error', 'listening', 'reading', 'sleeping', 'thinking', 'working'].sort(),
    );
  });
});
