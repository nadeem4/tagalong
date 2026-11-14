/** Tests for the gather overlay's pure maths: sampling, progress, positions, eyes, fade. */

import { describe, expect, it } from 'vitest';
import {
  eyeLight,
  gatherAlpha,
  gatherProgress,
  sampleTiles,
  speckPosition,
} from './scout-gather-math';

describe('sampleTiles', () => {
  it('skips transparent pixels', () => {
    // 4x4 image, tile 2: only the top-left tile has a visible centre pixel.
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data.set([10, 20, 30, 255], (1 * 4 + 1) * 4);
    const tiles = sampleTiles(data, 4, 2);
    expect(tiles).toEqual([{ x: 0, y: 0, c: (10 << 16) | (20 << 8) | 30 }]);
  });
});

describe('gatherProgress', () => {
  it('is about 0.6 while starting', () => {
    for (const t of [0, 500, 1300, 9000]) {
      expect(gatherProgress('starting', t, 0)).toBeGreaterThan(0.5);
      expect(gatherProgress('starting', t, 0)).toBeLessThan(0.7);
    }
  });
  it('reaches 1 within 900 ms of ready', () => {
    expect(gatherProgress('ready', 1000 + 900, 1000)).toBe(1);
    expect(gatherProgress('ready', 1000 + 450, 1000)).toBeLessThan(1);
  });
  it('settles near 0.4 when failed', () => {
    expect(gatherProgress('failed', 5000, 0)).toBeCloseTo(0.4, 1);
  });
});

describe('speckPosition', () => {
  it('at k=1 equals the tile', () => {
    expect(speckPosition({ x: 12, y: 30, c: 0 }, 1, 777, 5)).toEqual({ x: 12, y: 30 });
  });
  it('is scattered away from the tile at low k', () => {
    const p = speckPosition({ x: 12, y: 30, c: 0 }, 0.6, 0, 5);
    expect(Math.hypot(p.x - 12, p.y - 30)).toBeGreaterThan(1);
  });
});

describe('eyeLight', () => {
  it('stays dim until ready, then lights', () => {
    expect(eyeLight('starting', 500, 0)).toBeLessThan(0.4);
    expect(eyeLight('ready', 5000, 1000)).toBe(1);
  });
});

describe('gatherAlpha', () => {
  it('is 0 after the ready fade', () => {
    expect(gatherAlpha('ready', 3000, 1000)).toBe(0);
  });
  it('is full while starting and dimmed when failed', () => {
    expect(gatherAlpha('starting', 100, 0)).toBe(1);
    expect(gatherAlpha('failed', 100, 0)).toBeLessThan(1);
  });
});
