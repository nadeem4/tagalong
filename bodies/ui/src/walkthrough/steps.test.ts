/** Tests for STEPS and skipTour: twelve steps, Your brain first, only the key unskippable, Skip needs a key to close. */

import { describe, expect, it } from 'vitest';
import { KEY_STEP, STEPS, skipTour } from './steps';

describe('STEPS', () => {
  it('twelve steps, Your brain first, the key is step ten', () => {
    expect(STEPS.map((step) => step.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(STEPS[0]).toEqual({ id: 1, title: 'Your brain', skippable: true });
    expect(STEPS.filter((step) => !step.skippable).map((step) => step.id)).toEqual([10]);
    expect(KEY_STEP).toBe(10);
    expect(STEPS.find((step) => step.id === KEY_STEP)?.title).toBe('API key');
  });
});

describe('side list names', () => {
  it('names step 7 Everyday jobs and keeps its id', () => {
    expect(STEPS.find((step) => step.id === 7)?.title).toBe('Everyday jobs');
    expect(STEPS.find((step) => step.id === 3)?.title).toBe('How it works');
  });
});

describe('skipTour', () => {
  it('closes when the brain has a key', () => {
    expect(skipTour(true)).toBe('close');
  });

  it('jumps to the key step when there is no key, because the key cannot be skipped', () => {
    expect(skipTour(false)).toEqual({ goTo: 10 });
  });
});
