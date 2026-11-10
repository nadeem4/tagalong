/** Tests for parseTimersState: the brain's timers_state answer as the Timers tab reads it. */
import { describe, expect, it } from 'vitest';
import { parseTimersState } from './timers';

describe('parseTimersState', () => {
  it('reads timers and renames the snake_case fields', () => {
    expect(
      parseTimersState({
        timers: [
          {
            id: 't1',
            note: 'stretch',
            next_at: '2026-11-10T12:00:00+00:00',
            repeat_minutes: 30,
            pending: false,
          },
          {
            id: 't2',
            note: 'call Priya',
            next_at: '2026-11-10T13:00:00+00:00',
            repeat_minutes: null,
            pending: true,
          },
        ],
      }),
    ).toEqual([
      {
        id: 't1',
        note: 'stretch',
        nextAt: '2026-11-10T12:00:00+00:00',
        repeatMinutes: 30,
        pending: false,
      },
      {
        id: 't2',
        note: 'call Priya',
        nextAt: '2026-11-10T13:00:00+00:00',
        repeatMinutes: null,
        pending: true,
      },
    ]);
  });

  it('refuses a malformed answer', () => {
    expect(() => parseTimersState({ timers: [{ id: '' }] })).toThrow();
    expect(() => parseTimersState(null)).toThrow();
  });
});
