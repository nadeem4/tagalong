/* Tests for per-mood part visibility and the spring that scales a part in and out. */

import { describe, expect, it } from 'vitest';
import { gatedTargets, initialScales, stepPartScales } from './visibility';

const gated = [['coding'], ['coding', 'thinking'], ['sleeping']];

describe('gatedTargets', () => {
  it('is 1 for parts that list the mood and 0 for the rest', () => {
    expect(gatedTargets(gated, 'coding')).toEqual([1, 1, 0]);
    expect(gatedTargets(gated, 'thinking')).toEqual([0, 1, 0]);
    expect(gatedTargets(gated, 'idle')).toEqual([0, 0, 0]);
  });
});

describe('initialScales', () => {
  it('starts a fresh mascot settled in its mood', () => {
    expect(Array.from(initialScales(gated, 'sleeping'))).toEqual([0, 0, 1]);
  });
});

describe('stepPartScales', () => {
  it('grows toward 1 with a small overshoot, then settles', () => {
    const scale = Float32Array.of(0);
    const vel = new Float32Array(1);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepPartScales(scale, vel, [1], 1 / 60);
      peak = Math.max(peak, scale[0]);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
    expect(scale[0]).toBeCloseTo(1, 2);
  });

  it('shrinks to exactly 0 without a visible pop', () => {
    const scale = Float32Array.of(1);
    const vel = new Float32Array(1);
    for (let i = 0; i < 90; i++) stepPartScales(scale, vel, [0], 1 / 60);
    expect(scale[0]).toBe(0);
  });

  it('jumps straight to the target when no time passes (reduced motion)', () => {
    const scale = Float32Array.of(0, 1);
    const vel = Float32Array.of(3, 3);
    stepPartScales(scale, vel, [1, 0], 0);
    expect(Array.from(scale)).toEqual([1, 0]);
    expect(Array.from(vel)).toEqual([0, 0]);
  });

  it('stays stable on a very long frame', () => {
    const scale = Float32Array.of(0);
    stepPartScales(scale, new Float32Array(1), [1], 2);
    expect(Number.isFinite(scale[0])).toBe(true);
    expect(Math.abs(scale[0] - 1)).toBeLessThan(0.1);
  });
});
