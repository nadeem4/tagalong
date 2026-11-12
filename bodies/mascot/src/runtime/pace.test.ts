/* Tests for the frame pacer: a mascot capped at N fps skips frames and carries the skipped time. */

import { describe, expect, it } from 'vitest';
import { createPacer, createRate } from './pace';

describe('createPacer', () => {
  it('never skips when there is no cap', () => {
    const pace = createPacer(0);
    expect(pace(1 / 60)).toBe(1 / 60);
    expect(pace(1 / 144)).toBe(1 / 144);
  });

  it('draws the first frame at once', () => {
    expect(createPacer(30)(1 / 60)).toBeGreaterThan(0);
  });

  it('skips frames under the cap and hands the skipped time to the next one drawn', () => {
    const pace = createPacer(30);
    pace(1 / 60);
    const steps = Array.from({ length: 6 }, () => pace(1 / 60));
    const drawn = steps.filter((s) => s > 0);
    expect(drawn).toHaveLength(3);
    expect(drawn.reduce((a, b) => a + b, 0)).toBeCloseTo(6 / 60, 5);
  });
});

describe('createPacer with a changing rate', () => {
  it('draws at the rate asked for on each frame', () => {
    const pace = createPacer(30);
    pace(1 / 60);
    // at 10 fps a 60 Hz display draws one frame in six
    const drawn = Array.from({ length: 60 }, () => pace(1 / 60, 10)).filter((s) => s > 0);
    expect(drawn).toHaveLength(10);
  });
});

describe('createRate', () => {
  it('draws at the full cap while anything moves, and slows only when calm and still', () => {
    const rate = createRate(30, 10);
    expect(rate.next(1 / 60, { calm: false, moving: false })).toBe(30);
    expect(rate.next(1 / 60, { calm: true, moving: true })).toBe(30);
    // the boost from the start has not run out yet
    expect(rate.next(1 / 60, { calm: true, moving: false })).toBe(30);
    for (let i = 0; i < 200; i++) rate.next(1 / 60, { calm: true, moving: false });
    expect(rate.next(1 / 60, { calm: true, moving: false })).toBe(10);
  });

  it('goes back to the full cap for a moment after a change, so springs stay smooth', () => {
    const rate = createRate(30, 10);
    for (let i = 0; i < 200; i++) rate.next(1 / 60, { calm: true, moving: false });
    rate.bump();
    expect(rate.next(1 / 60, { calm: true, moving: false })).toBe(30);
    for (let i = 0; i < 200; i++) rate.next(1 / 60, { calm: true, moving: false });
    expect(rate.next(1 / 60, { calm: true, moving: false })).toBe(10);
  });

  it('never slows without a calm rate, and treats no cap as no limit', () => {
    const rate = createRate(30, 0);
    for (let i = 0; i < 200; i++) rate.next(1 / 60, { calm: true, moving: false });
    expect(rate.next(1 / 60, { calm: true, moving: false })).toBe(30);
    expect(createRate(0, 10).next(1, { calm: true, moving: false })).toBe(0);
  });
});
