/** Tests for the walkthrough's launch gate: when it opens at launch and when the pets show. */

import { describe, expect, it } from 'vitest';
import { petsVisible, shouldOpenWalkthrough } from './walkthrough-gate';

describe('shouldOpenWalkthrough', () => {
  it('opens at launch until the tour is finished or skipped', () => {
    expect(shouldOpenWalkthrough({ walkthrough: { done: false } })).toBe(true);
  });

  it('stays closed once the tour is done', () => {
    expect(shouldOpenWalkthrough({ walkthrough: { done: true } })).toBe(false);
  });
});

describe('petsVisible', () => {
  it('hides the pet, bubble and dock while the walkthrough is open', () => {
    expect(petsVisible({ walkthroughOpen: true })).toBe(false);
  });

  it('shows them when it is not open (finished, or closed part-way)', () => {
    expect(petsVisible({ walkthroughOpen: false })).toBe(true);
  });
});
