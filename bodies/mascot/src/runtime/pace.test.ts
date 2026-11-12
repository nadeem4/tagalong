/* Tests for the frame pacer: a mascot capped at N fps skips frames and carries the skipped time. */

import { describe, expect, it } from 'vitest';
import { createPacer } from './pace';

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
