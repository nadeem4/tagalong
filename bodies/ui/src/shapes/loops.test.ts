/** Tests for parseLoopsState: the brain's loops_state answer as Home reads it. */
import { describe, expect, it } from 'vitest';
import { parseLoopsState } from './loops';

const LOOP = {
  id: 'a1',
  app: 'gmail',
  title: 'Send Priya the deck',
  asks: 'the Q4 deck',
  direction: 'i_owe',
  due: '2026-11-06T09:00:00+00:00',
  people: ['Priya'],
  status: 'held',
};

describe('parseLoopsState', () => {
  it('reads apps and loops, and renames unread_since', () => {
    const state = parseLoopsState({
      apps: [
        { id: 'gmail', name: 'Gmail', on: true, unread_since: '2026-11-04T09:00:00+00:00' },
        { id: 'g2', name: 'Work', on: false },
      ],
      loops: [LOOP, { ...LOOP, id: 'b2', due: null, direction: 'they_owe' }],
    });
    expect(state.apps[0]).toEqual({
      id: 'gmail',
      name: 'Gmail',
      on: true,
      unreadSince: '2026-11-04T09:00:00+00:00',
    });
    expect(state.apps[1]?.unreadSince).toBeUndefined();
    expect(state.loops.map((l) => l.due)).toEqual([LOOP.due, null]);
  });

  it('rejects a direction or status it does not know', () => {
    expect(() => parseLoopsState({ apps: [], loops: [{ ...LOOP, direction: 'x' }] })).toThrow();
    expect(() => parseLoopsState({ apps: [], loops: [{ ...LOOP, status: 'x' }] })).toThrow();
  });
});
