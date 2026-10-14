import { describe, expect, it } from 'vitest';
import { dueSlot, latestDue, nextDue, zonedToEpoch } from './schedule';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

const WEEKDAYS_8 = { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' } as const;
const daily = (time: string) => ({ type: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], time }) as const;

describe('zonedToEpoch', () => {
  it('reads a wall time in the zone, summer and winter', () => {
    expect(iso(zonedToEpoch({ year: 2026, month: 1, day: 5, hour: 8, minute: 0 }, LONDON))).toBe(
      '2026-01-05T08:00:00.000Z',
    );
    expect(iso(zonedToEpoch({ year: 2026, month: 7, day: 6, hour: 8, minute: 0 }, LONDON))).toBe(
      '2026-07-06T07:00:00.000Z',
    );
    expect(iso(zonedToEpoch({ year: 2026, month: 7, day: 6, hour: 8, minute: 0 }, NEW_YORK))).toBe(
      '2026-07-06T12:00:00.000Z',
    );
  });

  it('moves a time the clocks skip forward by the gap', () => {
    // London skips 01:00-02:00 on 29 March 2026; New York skips 02:00-03:00 on 8 March.
    expect(iso(zonedToEpoch({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LONDON))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(iso(zonedToEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('takes the first of a time the clocks repeat', () => {
    // London repeats 01:00-02:00 on 25 October 2026.
    expect(iso(zonedToEpoch({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LONDON))).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});

describe('latestDue and nextDue', () => {
  it('finds the slot just passed and the next one, skipping the weekend', () => {
    // Monday 12 October 2026.
    expect(iso(latestDue(WEEKDAYS_8, at('2026-10-12T07:00:10Z'), LONDON))).toBe(
      '2026-10-12T07:00:00.000Z',
    );
    // Friday 16 October, after the slot: next is Monday 19.
    expect(iso(nextDue(WEEKDAYS_8, at('2026-10-16T09:00:00Z'), LONDON))).toBe(
      '2026-10-19T07:00:00.000Z',
    );
    // Sunday 18 October: the last slot was Friday's.
    expect(iso(latestDue(WEEKDAYS_8, at('2026-10-18T12:00:00Z'), LONDON))).toBe(
      '2026-10-16T07:00:00.000Z',
    );
  });

  it('keeps the wall time across a clock change', () => {
    const eight = daily('08:00');
    expect(iso(nextDue(eight, at('2026-03-28T09:00:00Z'), LONDON))).toBe(
      '2026-03-29T07:00:00.000Z',
    );
    expect(iso(nextDue(eight, at('2026-10-24T09:00:00Z'), LONDON))).toBe(
      '2026-10-25T08:00:00.000Z',
    );
  });

  it('runs a repeated hour once, and a skipped one an hour late', () => {
    const half = daily('01:30');
    const first = nextDue(half, at('2026-10-24T12:00:00Z'), LONDON);
    expect(iso(first)).toBe('2026-10-25T00:30:00.000Z');
    // Not again at the second 01:30 that night: the next is the next night.
    expect(iso(nextDue(half, first!, LONDON))).toBe('2026-10-26T01:30:00.000Z');
    expect(iso(nextDue(half, at('2026-03-28T12:00:00Z'), LONDON))).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('dueSlot', () => {
  const monday8 = at('2026-10-12T07:00:00Z');

  it('is the latest slot not yet handled, or null', () => {
    expect(dueSlot(WEEKDAYS_8, monday8 - 1, at('2026-10-12T07:00:05Z'), LONDON)).toBe(monday8);
    expect(dueSlot(WEEKDAYS_8, monday8, at('2026-10-12T07:00:35Z'), LONDON)).toBeNull();
  });

  it('collapses every slot missed while the PC was off into one, the latest', () => {
    // Handled Monday, then off until Thursday 10:00: one run, for Thursday's slot.
    expect(iso(dueSlot(WEEKDAYS_8, monday8, at('2026-10-15T09:00:00Z'), LONDON))).toBe(
      '2026-10-15T07:00:00.000Z',
    );
  });
});
