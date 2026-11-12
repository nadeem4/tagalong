/* Tests for attachProps: a prop's parts, bones and materials join a character and show only in the named moods. */

import { describe, expect, it } from 'vitest';
import {
  attachProps,
  desk,
  headphones,
  laptop,
  lightbulb,
  nightcap,
  notepad,
  partyHat,
  pillow,
  tablet,
  wrench,
  type PropSpec,
} from '.';
import { compile } from '../compiler/compile';
import type { CharacterSpec } from '../spec/types';

const base: CharacterSpec = {
  id: 'test',
  name: 'Test',
  tagline: 't',
  accent: '#ffffff',
  frame: { target: 0.5, radius: 1 },
  bound: { y: 0.5, radius: 1.5 },
  materials: { skin: { color: '#88aaff' } },
  bones: [
    { name: 'head', pivot: [0, 0.5, 0] },
    { name: 'hand', pivot: [0.5, 0.3, 0] },
  ],
  parts: [{ bone: 'head', shape: 'sphere', radius: 0.4, material: 'skin' }],
  moods: { coding: { base: 'working' } },
};

describe('attachProps', () => {
  it('leaves the original spec alone', () => {
    const before = JSON.stringify(base);
    attachProps(base, [[lightbulb, { bone: 'head', moods: ['thinking'] }]]);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('adds the prop parts gated to the named moods, with namespaced materials', () => {
    const out = attachProps(base, [
      [lightbulb, { bone: 'head', at: [0, 0.6, 0], moods: ['thinking'] }],
    ]);
    const added = out.parts.slice(base.parts.length);
    expect(added).toHaveLength(lightbulb.parts.length);
    expect(added.every((p) => p.moods?.[0] === 'thinking' && p.material.startsWith('bulb.'))).toBe(
      true,
    );
    expect(added.every((p) => p.bone === 'head')).toBe(true);
    expect(out.materials['bulb.glass']).toBeDefined();
  });

  it('recolours a prop material by its local name', () => {
    const out = attachProps(base, [
      [partyHat, { bone: 'head', moods: ['celebrating'], colors: { cone: '#ff0000' } }],
    ]);
    expect(out.materials['hat.cone'].color).toBe('#ff0000');
    expect(out.materials['hat.trim'].color).toBe(partyHat.materials.trim.color);
  });

  it('scales lengths and places the prop at the attach offset', () => {
    const out = attachProps(base, [
      [lightbulb, { bone: 'head', at: [0, 1, 0], scale: 2, moods: ['x'] }],
    ]);
    const sphere = out.parts[base.parts.length] as { radius: number; at: [number, number, number] };
    expect(sphere.radius).toBeCloseTo(0.28);
    expect(sphere.at).toEqual([0, 1, 0]);
  });

  it('hangs prop bones on the attach bone and namespaces their acting', () => {
    const out = attachProps(base, [[laptop, { bone: 'hand', moods: ['coding'] }]]);
    expect(out.bones.find((b) => b.name === 'laptop.lid')?.parent).toBe('hand');
    expect(out.acting?.working?.['laptop.lid']).toBeDefined();
    expect(out.parts.some((p) => p.bone === 'laptop.lid')).toBe(true);
  });

  it('rejects a prop that carves the character', () => {
    const carver: PropSpec = {
      name: 'c',
      materials: { m: { color: '#000000' } },
      parts: [{ bone: 'attach', shape: 'sphere', radius: 1, material: 'm', op: 'sub' }],
    };
    expect(() => attachProps(base, [[carver, { bone: 'head', moods: ['x'] }]])).toThrow(
      /cannot use op "sub"/,
    );
  });

  it('rejects a part on a bone the prop does not declare', () => {
    const lost: PropSpec = {
      name: 'l',
      materials: { m: { color: '#000000' } },
      parts: [{ bone: 'nope', shape: 'sphere', radius: 1, material: 'm' }],
    };
    expect(() => attachProps(base, [[lost, { bone: 'head', moods: ['x'] }]])).toThrow(
      /does not declare/,
    );
  });
});

describe('the prop library', () => {
  const library = {
    laptop,
    desk,
    lightbulb,
    tablet,
    notepad,
    headphones,
    pillow,
    nightcap,
    partyHat,
    wrench,
  };
  it.each(Object.entries(library))('%s compiles on a character', (_name, prop) => {
    const spec = attachProps(base, [[prop, { bone: 'head', moods: ['coding'] }]]);
    const compiled = compile(spec);
    expect(compiled.gated).toHaveLength(prop.parts.length);
    expect(compiled.gated.every((m) => m[0] === 'coding')).toBe(true);
  });
});
