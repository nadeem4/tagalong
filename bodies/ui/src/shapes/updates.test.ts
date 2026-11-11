/** Tests for parseUpdatesState: the brain's updates_state answer as the Connections page reads it. */
import { describe, expect, it } from 'vitest';
import { parseUpdatesState, pendingUpdates } from './updates';

const ROW = {
  kind: 'app',
  id: 'github',
  name: 'GitHub',
  installed: '0.9',
  latest: '1.0',
  remote: false,
  official: true,
  auto: true,
  status: 'idle',
};
const AUTO = {
  apps: { official: true, community: false },
  experts: { official: true, community: false },
};

describe('parseUpdatesState', () => {
  it('reads the rows, the time and the group switches', () => {
    const state = parseUpdatesState({
      checkedAt: '2026-11-10T12:00:00+00:00',
      auto: AUTO,
      items: [ROW],
    });
    expect(state.checkedAt).toBe('2026-11-10T12:00:00+00:00');
    expect(state.auto.apps.community).toBe(false);
    expect(state.items[0]).toMatchObject({ id: 'github', latest: '1.0', status: 'idle' });
  });

  it('never checked reads as null; a remote row has no latest', () => {
    const state = parseUpdatesState({
      checkedAt: null,
      auto: AUTO,
      items: [{ ...ROW, remote: true, latest: null, installed: '' }],
    });
    expect(state.checkedAt).toBeNull();
    expect(state.items[0]?.latest).toBeNull();
  });

  it('refuses a malformed answer', () => {
    expect(() => parseUpdatesState({ items: [{ id: '' }] })).toThrow();
    expect(() => parseUpdatesState(null)).toThrow();
  });
});

describe('pendingUpdates', () => {
  it('counts the rows of one kind with an update that is not already on its way', () => {
    const state = parseUpdatesState({
      checkedAt: null,
      auto: AUTO,
      items: [
        ROW,
        { ...ROW, id: 'b' },
        { ...ROW, id: 'c', status: 'updating' },
        { ...ROW, id: 'd', latest: null },
        { ...ROW, id: 'e', kind: 'expert' },
      ],
    });
    expect(pendingUpdates(state, 'app')).toBe(2);
    expect(pendingUpdates(state, 'expert')).toBe(1);
  });
});
