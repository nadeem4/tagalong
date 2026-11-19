/** Tests for parseTasksList: the brain's tasks_list answer as the Tasks page reads it. */
import { describe, expect, it } from 'vitest';
import { parseTasksList } from './tasks';

const wire = {
  id: 't1',
  kind: 'watch',
  state: 'open',
  title: 'Gmail',
  source: 'timer:w1',
  caused_by: 'e1',
  chain: [{ kind: 'say', source: 'desktop' }],
  created_at: '2026-11-17T10:00:00+00:00',
  ended_at: null,
};

describe('parseTasksList', () => {
  it('parses a task row with its chain', () => {
    expect(parseTasksList({ tasks: [wire] })).toEqual([
      {
        id: 't1',
        kind: 'watch',
        state: 'open',
        title: 'Gmail',
        source: 'timer:w1',
        chain: [{ kind: 'say', source: 'desktop' }],
        createdAt: '2026-11-17T10:00:00+00:00',
        endedAt: null,
      },
    ]);
  });

  it('drops a row that is malformed', () => {
    expect(
      parseTasksList({ tasks: [{ ...wire, id: '' }, { nope: 1 }, { ...wire, id: 't2' }] }),
    ).toHaveLength(1);
  });
});
