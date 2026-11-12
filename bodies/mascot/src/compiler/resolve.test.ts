/* Tests for spec validation of moods: bases must be expressions, part moods must be known. */

import { describe, expect, it } from 'vitest';
import { resolve, SpecError } from './resolve';
import type { CharacterSpec } from '../spec/types';

const base = (over: Partial<CharacterSpec>): CharacterSpec => ({
  id: 'v',
  name: 'V',
  tagline: 't',
  accent: '#ffffff',
  frame: { target: 0.5, radius: 1 },
  bound: { y: 0.5, radius: 1.5 },
  materials: { skin: { color: '#88aaff' } },
  bones: [],
  parts: [{ bone: 'root', shape: 'sphere', radius: 0.4, material: 'skin' }],
  ...over,
});

describe('resolve moods', () => {
  it('accepts a custom mood on an expression and parts gated to it', () => {
    const spec = base({
      moods: { coding: { base: 'working' } },
      parts: [
        { bone: 'root', shape: 'sphere', radius: 0.4, material: 'skin', moods: ['coding', 'idle'] },
      ],
    });
    expect(() => resolve(spec)).not.toThrow();
  });

  it('rejects a mood whose base is not a state', () => {
    const spec = base({ moods: { coding: { base: 'busy' as never } } });
    expect(() => resolve(spec)).toThrow(SpecError);
    expect(() => resolve(spec)).toThrow(/moods.coding.base/);
  });

  it('rejects a mood named like a built-in state', () => {
    expect(() => resolve(base({ moods: { idle: { base: 'working' } } }))).toThrow(/built-in/);
  });

  it('rejects a part gated to an unknown mood', () => {
    const spec = base({
      parts: [{ bone: 'root', shape: 'sphere', radius: 0.4, material: 'skin', moods: ['typo'] }],
    });
    expect(() => resolve(spec)).toThrow(/parts\[0\].*"typo"/);
  });

  it('rejects an empty moods list, which would never show', () => {
    const spec = base({
      parts: [{ bone: 'root', shape: 'sphere', radius: 0.4, material: 'skin', moods: [] }],
    });
    expect(() => resolve(spec)).toThrow(/empty/);
  });
});
