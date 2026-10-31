/** Tests for STEPS and skipTour: nine steps, only the key unskippable, Skip tour needs a key to close. */

import { describe, expect, it } from 'vitest';
import { STEPS, skipTour } from './steps';

describe('STEPS', () => {
  it('has nine steps numbered 1 to 9, and only the last cannot be skipped', () => {
    expect(STEPS.map((step) => step.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(STEPS.filter((step) => !step.skippable).map((step) => step.id)).toEqual([9]);
  });
});

describe('skipTour', () => {
  it('closes when the brain has a key', () => {
    expect(skipTour(true)).toBe('close');
  });

  it('jumps to step 9 when there is no key, because the key cannot be skipped', () => {
    expect(skipTour(false)).toEqual({ goTo: 9 });
  });
});
