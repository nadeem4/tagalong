/* Tests for a custom mood's face overrides in the brain: they replace the base expression's targets. */

import { describe, expect, it } from 'vitest';
import { Brain } from './brain';

/* the glow is pulsed, so compare its colour balance rather than exact values */
const settle = (b: Brain) => {
  for (let i = 0; i < 300; i++) b.update(1 / 60);
  return b.pose.glow;
};

describe('Brain moving', () => {
  it('is moving during a hop, so the mascot draws at its full rate', () => {
    const b = new Brain({}, 0.5);
    b.poke();
    b.update(1 / 60);
    expect(b.moving).toBe(true);
  });

  it('is still between hops and blinks', () => {
    const b = new Brain({}, 0.5);
    const states = new Set<boolean>();
    for (let i = 0; i < 1200; i++) {
      b.update(1 / 60);
      states.add(b.moving);
    }
    expect(states.has(false)).toBe(true);
  });
});

describe('Brain face override', () => {
  it('uses the base expression when there is no override', () => {
    const b = new Brain({}, 0.5);
    b.setState('working');
    const [r, g] = settle(b);
    expect(r).toBeGreaterThan(g); // working glows violet
  });

  it('applies overrides on top of the base expression', () => {
    const b = new Brain({}, 0.5);
    b.setState('working', { glow: [0.1, 0.9, 0.1] });
    const [r, g] = settle(b);
    expect(g).toBeGreaterThan(r * 3);
  });

  it('applies a new override even when the base expression is unchanged', () => {
    const b = new Brain({}, 0.5);
    b.setState('working');
    b.setState('working', { glow: [0.1, 0.9, 0.1] });
    const [r, g] = settle(b);
    expect(g).toBeGreaterThan(r * 3);
  });

  it('drops the override when the mood changes back', () => {
    const b = new Brain({}, 0.5);
    b.setState('working', { glow: [0.1, 0.9, 0.1] });
    settle(b);
    b.setState('working');
    const [r, g] = settle(b);
    expect(r).toBeGreaterThan(g);
  });
});
