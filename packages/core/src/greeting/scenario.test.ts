/** Tests for launchScenario: update, crash, pick-up, away and normal. */
import { describe, expect, it } from 'vitest';
import { launchScenario } from './scenario';
import type { LaunchFacts } from './scenario';

const now = new Date(2026, 9, 14, 9);
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const plain: LaunchFacts = {
  crashed: false,
  lastVersion: '0.4.0',
  version: '0.4.0',
  now,
  awaySince: hoursAgo(2),
  pickUpReady: false,
};

describe('launchScenario', () => {
  it('is a normal launch when nothing happened', () => {
    expect(launchScenario(plain)).toBe('normal');
    expect(launchScenario({ ...plain, awaySince: null })).toBe('normal');
  });

  it('is days away from a day after the last close', () => {
    expect(launchScenario({ ...plain, awaySince: hoursAgo(23) })).toBe('normal');
    expect(launchScenario({ ...plain, awaySince: hoursAgo(24) })).toBe('away');
  });

  it('is an update when the version differs from the last one', () => {
    expect(launchScenario({ ...plain, version: '0.5.0' })).toBe('update');
  });

  it('is never an update when no version was recorded before', () => {
    expect(launchScenario({ ...plain, lastVersion: null, version: '0.5.0' })).toBe('normal');
  });

  it('puts an update over a crash (an installer ends the app by force), a crash over days away', () => {
    const everything = { ...plain, crashed: true, version: '0.5.0', awaySince: hoursAgo(72) };
    expect(launchScenario(everything)).toBe('update');
    expect(launchScenario({ ...everything, crashed: false })).toBe('update');
    expect(launchScenario({ ...everything, version: '0.4.0' })).toBe('crash');
    expect(launchScenario({ ...everything, lastVersion: null })).toBe('crash');
  });

  it('puts a pick-up over days away, and an update or a crash over a pick-up', () => {
    const back = { ...plain, pickUpReady: true };
    expect(launchScenario(back)).toBe('pickUp');
    expect(launchScenario({ ...back, awaySince: hoursAgo(72) })).toBe('pickUp');
    expect(launchScenario({ ...back, version: '0.5.0' })).toBe('update');
    expect(launchScenario({ ...back, crashed: true })).toBe('crash');
  });

  it('reads as before with no snapshot ready', () => {
    expect(launchScenario({ ...plain, awaySince: hoursAgo(72) })).toBe('away');
    expect(launchScenario(plain)).toBe('normal');
  });
});
