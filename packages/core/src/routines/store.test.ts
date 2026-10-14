import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { RoutineDraftInput } from '@tagalong/protocol';
import { migrate } from '../memory/db';
import { RoutineStore } from './store';

const PAPERS: RoutineDraftInput = {
  name: 'Morning papers',
  when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
  what: 'Find new papers on my topics.',
  topics: 'AI agents',
};

const T0 = Date.parse('2026-10-12T06:00:00Z');

function store(): { routines: RoutineStore; db: Database.Database } {
  const db = new Database(':memory:');
  migrate(db);
  return { routines: new RoutineStore(db), db };
}

describe('RoutineStore', () => {
  it('saves a new routine with an id and its defaults, starting its schedule from now', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.createdAt).toBe('2026-10-12T06:00:00.000Z');
    expect(saved.deliver).toEqual({ bubble: true, voice: false, notification: false });
    const [row] = routines.list();
    expect(row?.routine).toEqual(saved);
    expect(row?.lastDueAt).toBe(T0);
  });

  it('edits in place, keeps the date, and restarts the schedule only when "when" changed', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    routines.markDue(saved.id, T0 + 1_000);
    routines.save({ ...PAPERS, id: saved.id, what: 'Only arXiv.' }, T0 + 5_000);
    expect(routines.get(saved.id)?.routine.what).toBe('Only arXiv.');
    expect(routines.get(saved.id)?.routine.createdAt).toBe(saved.createdAt);
    expect(routines.get(saved.id)?.lastDueAt).toBe(T0 + 1_000);

    routines.save(
      { ...PAPERS, id: saved.id, when: { type: 'schedule', days: [1], time: '09:00' } },
      T0 + 9_000,
    );
    expect(routines.get(saved.id)?.lastDueAt).toBe(T0 + 9_000);
    expect(routines.list()).toHaveLength(1);
  });

  it('switches off and on; on again skips what was missed while off', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    routines.setEnabled(saved.id, false, T0 + 1);
    expect(routines.get(saved.id)?.routine.enabled).toBe(false);
    routines.setEnabled(saved.id, true, T0 + 99_000);
    expect(routines.get(saved.id)?.routine.enabled).toBe(true);
    expect(routines.get(saved.id)?.lastDueAt).toBe(T0 + 99_000);
  });

  it('finds one by name, whatever the case', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    expect(routines.findByName('morning PAPERS')?.routine.id).toBe(saved.id);
    expect(routines.findByName('evening')).toBeNull();
  });

  it('records how the last run went', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    routines.runStarted(saved.id, T0 + 10, 'activity-1');
    expect(routines.get(saved.id)).toMatchObject({
      lastRunAt: T0 + 10,
      lastState: 'running',
      lastActivityId: 'activity-1',
    });
    routines.runFinished(saved.id, 'done');
    expect(routines.get(saved.id)?.lastState).toBe('done');
  });

  it('deletes', () => {
    const { routines } = store();
    const saved = routines.save(PAPERS, T0);
    expect(routines.delete(saved.id)).toBe(true);
    expect(routines.delete(saved.id)).toBe(false);
    expect(routines.list()).toEqual([]);
  });

  it('refuses an edit of a routine that is gone', () => {
    const { routines } = store();
    expect(() =>
      routines.save({ ...PAPERS, id: '6f1c2f4e-8a7b-4c1d-9e2f-3a4b5c6d7e8f' }, T0),
    ).toThrow(/no routine/);
  });
});
