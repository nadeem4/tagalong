/** Tests for ActiveTime: stretches, breaks, late nights and clock jumps. Timing only. */
import { describe, expect, it } from 'vitest';
import { ActiveTime, BREAK_MS, LATE_ACTIVE_MS, STRETCH_MS } from './active-time';

const MINUTE = 60_000;

function setup(hour = 14) {
  const time = { t: 0, hour };
  const active = new ActiveTime();
  const tick = (idleMs = 0) => {
    time.t += MINUTE;
    return active.observe(idleMs, time.t, time.hour);
  };
  /** Ticks to `minutes` from the start, returning the last result. */
  const until = (minutes: number, idleMs = 0) => {
    let last = tick(idleMs);
    while (time.t < minutes * MINUTE) last = tick(idleMs);
    return last;
  };
  return { time, active, tick, until };
}

describe('ActiveTime', () => {
  it('is due for a stretch at 90 minutes, once a stretch once consumed', () => {
    const { active, until, tick } = setup();
    expect(until(STRETCH_MS / MINUTE).due).toBeNull();
    const due = tick();
    expect(due.due).toBe('stretch');
    expect(due.activeMs).toBeGreaterThanOrEqual(STRETCH_MS);
    // Not consumed (the wake was refused): still due on the next tick.
    expect(tick().due).toBe('stretch');
    active.consume('stretch', 0);
    expect(tick().due).toBeNull();
  });

  it('a five-minute idle is a break: it reports brokeOff and starts the stretch over', () => {
    const { active, until, tick } = setup();
    until(100);
    active.consume('stretch', 0);
    const broke = tick(BREAK_MS);
    expect(broke.brokeOff).toBe(true);
    expect(broke.activeMs).toBe(0);
    expect(tick(BREAK_MS).brokeOff).toBe(false);
    expect(tick().activeMs).toBe(0);
    expect(tick().activeMs).toBe(MINUTE);
  });

  it('late at night, 30 minutes active is due once a night, even after a break', () => {
    const { active, until, tick, time } = setup(23);
    expect(until(LATE_ACTIVE_MS / MINUTE - 1).due).toBeNull();
    const late = until(LATE_ACTIVE_MS / MINUTE + 1);
    expect(late.due).toBe('late');
    active.consume('late', time.t);
    tick(BREAK_MS);
    expect(until(LATE_ACTIVE_MS / MINUTE + 40).due).toBeNull();
  });

  it('a late line counts for the stretch too', () => {
    const { active, until, time } = setup(0);
    until(31);
    active.consume('late', time.t);
    expect(until(120).due).toBeNull();
  });

  it('is due late again the next night', () => {
    const { active, until, time } = setup(23);
    until(31);
    active.consume('late', time.t);
    time.hour = 14;
    until(31 + 13 * 60);
    time.hour = 23;
    expect(until(31 + 13 * 60 + 1).due).not.toBeNull();
  });

  it('says nothing late during the day', () => {
    const { until } = setup(14);
    expect(until(60).due).toBeNull();
  });

  it('a long gap between ticks (sleep, switched off) or a clock set back is a break', () => {
    const { active, until, time } = setup();
    until(100);
    time.t += BREAK_MS;
    const woke = active.observe(0, time.t, time.hour);
    expect(woke.brokeOff).toBe(true);
    expect(woke.due).toBeNull();
    until(140);
    time.t -= 10 * MINUTE;
    expect(active.observe(0, time.t, time.hour).activeMs).toBe(0);
  });

  it('reset starts the stretch over', () => {
    const { active, until, tick } = setup();
    until(100);
    active.reset();
    expect(tick().activeMs).toBe(0);
  });
});
