/** Tests for parseEventsWaiting: the brain's events_waiting answer as the Waiting tab reads it. */
import { describe, expect, it } from 'vitest';
import { parseEventsWaiting } from './events';

describe('parseEventsWaiting', () => {
  it('reads rows and renames the snake_case fields', () => {
    expect(
      parseEventsWaiting({
        waiting: [
          {
            id: 'e1',
            kind: 'job_done',
            source: 'job:j1',
            at: '2026-11-17T10:00:00+00:00',
            age_s: 90,
            gave_up: true,
            gist: 'Fix the build',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'e1',
        kind: 'job_done',
        source: 'job:j1',
        ageS: 90,
        gaveUp: true,
        gist: 'Fix the build',
      },
    ]);
  });

  it('rejects a row with no id', () => {
    expect(() =>
      parseEventsWaiting({
        waiting: [{ id: '', kind: 'x', source: 's', at: 'a', age_s: 1, gave_up: false, gist: '' }],
      }),
    ).toThrow();
  });
});
