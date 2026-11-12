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

/* a slow, calm draw: a quarter second per update unless the brain says it is moving */
const slowRun = (b: Brain, seconds: number) => {
  const priv = b as unknown as { blinkAge: number };
  let blinks = 0;
  let unseen = 0;
  let glances = 0;
  for (let t = 0; t < seconds;) {
    const fast = b.moving;
    const dt = fast ? 1 / 30 : 0.25;
    const before = priv.blinkAge;
    b.update(dt);
    t += dt;
    if (before < 0 && priv.blinkAge >= 0) {
      blinks++;
      if (!fast) unseen++;
    }
    if (b.moving) glances++;
  }
  return { blinks, unseen, glances };
};

describe('Brain moving at a slow rate', () => {
  it('sees every blink coming, so none starts inside a slow frame', () => {
    const { blinks, unseen } = slowRun(new Brain({}, 0.5), 300);
    expect(blinks).toBeGreaterThan(30);
    expect(unseen).toBe(0);
  });

  it('still rests between events, so most of the time is drawn at the slow rate', () => {
    const b = new Brain({}, 0.5);
    let slow = 0;
    let total = 0;
    while (total < 120) {
      const dt = b.moving ? 1 / 30 : 0.25;
      if (dt > 0.1) slow += dt;
      total += dt;
      b.update(dt);
    }
    expect(slow / total).toBeGreaterThan(0.5);
  });

  it('counts a fresh head glance as moving for a moment', () => {
    const b = new Brain({}, 0.5);
    const priv = b as unknown as { nextLook: number; time: number };
    b.update(0.25);
    priv.nextLook = priv.time - 0.01;
    b.update(0.25);
    expect(b.moving).toBe(true);
    for (let i = 0; i < 40 && b.moving; i++) b.update(0.05);
    expect(b.moving && priv.time < 5).toBe(false);
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
