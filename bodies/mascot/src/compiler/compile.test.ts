/* Tests for the shader the compiler writes. The shader's build time on Windows (ANGLE and its
   HLSL compiler) grows far faster than its size with every place that inlines the distance
   field, so the number of those places is pinned here. Not from wobnimo. */

import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import type { CharacterSpec } from '../spec/types';

const spec: CharacterSpec = {
  id: 'v',
  name: 'V',
  tagline: 't',
  accent: '#ffffff',
  frame: { target: 0.5, radius: 1 },
  bound: { y: 0.5, radius: 1.5 },
  materials: { skin: { color: '#88aaff' } },
  bones: [],
  parts: [{ bone: 'root', shape: 'sphere', radius: 0.4, material: 'skin' }],
};

/* calls of the distance field, apart from its own definition */
const queries = (fragment: string) => (fragment.match(/\bmap\(/g) ?? []).length - 1;

describe('compile', () => {
  it('reads the material from the march, with no extra distance query at the hit', () => {
    expect(compile(spec).fragment).not.toContain('map(p).y');
  });

  it('queries the distance field in a handful of places', () => {
    expect(queries(compile(spec).fragment)).toBeLessThanOrEqual(6);
  });

  it('leaves the floor shadow out when there is no floor', () => {
    const withFloor = compile(spec).fragment;
    const without = compile(spec, { floor: false }).fragment;
    expect(withFloor).toContain('softShadow(fp');
    expect(without).not.toContain('softShadow(fp');
    expect(queries(without)).toBe(queries(withFloor) - 1);
  });

  it('writes the LED face once, however many times it is sampled', () => {
    const screen: CharacterSpec = {
      ...spec,
      materials: { skin: { color: '#88aaff' }, screen: { color: '#101020' } },
      parts: [{ bone: 'root', shape: 'sphere', radius: 0.4, material: 'screen' }],
      face: {
        kind: 'screen',
        bone: 'root',
        material: 'screen',
        center: [0, 0],
        half: [0.3, 0.2],
        corner: 0.05,
        cell: 0.03,
        color: '#7cb8f2',
      },
    };
    const calls = compile(screen).fragment.match(/faceFor\(/g) ?? [];
    // its definition and one call
    expect(calls).toHaveLength(2);
    // the eyes and the mouth are shared by states, so each is written once too
    const frag = compile(screen).fragment;
    expect(frag.match(/faceEyes\(/g)).toHaveLength(2);
    expect(frag.match(/faceMouth\(/g)).toHaveLength(2);
  });
});
