import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { Routine, RoutineDraft, type RoutineDraftInput } from '@tagalong/protocol';

/** A saved routine and how it stands: its schedule and its last run. Times in epoch ms. */
export interface StoredRoutine {
  routine: Routine;
  /** The latest schedule slot handled, or when the schedule (re)started. */
  lastDueAt: number;
  lastRunAt?: number;
  lastState?: 'running' | 'done' | 'error';
  lastActivityId?: string;
}

interface Row {
  json: string;
  last_due_at: string | null;
  last_run_at: string | null;
  last_state: string | null;
  last_activity_id: string | null;
  updated_at: string;
}

function toStored(row: Row): StoredRoutine {
  const routine = Routine.parse(JSON.parse(row.json));
  return {
    routine,
    lastDueAt: Date.parse(row.last_due_at ?? row.updated_at),
    ...(row.last_run_at !== null ? { lastRunAt: Date.parse(row.last_run_at) } : {}),
    ...(row.last_state !== null
      ? { lastState: row.last_state as NonNullable<StoredRoutine['lastState']> }
      : {}),
    ...(row.last_activity_id !== null ? { lastActivityId: row.last_activity_id } : {}),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Routines in the `routines` table (migration 13): the definition as JSON, the run state beside it. */
export class RoutineStore {
  constructor(private readonly db: Database) {}

  list(): StoredRoutine[] {
    return this.db.prepare<[], Row>('SELECT * FROM routines ORDER BY rowid').all().map(toStored);
  }

  get(id: string): StoredRoutine | null {
    const row = this.db.prepare<[string], Row>('SELECT * FROM routines WHERE id = ?').get(id);
    return row === undefined ? null : toStored(row);
  }

  findByName(name: string): StoredRoutine | null {
    const wanted = name.trim().toLowerCase();
    return this.list().find((stored) => stored.routine.name.toLowerCase() === wanted) ?? null;
  }

  /**
   * Saves a new routine, or an edit when `id` is given. The schedule starts from `now`, so a
   * slot earlier today does not run the moment it is saved; an edit keeps its place unless
   * its "when" changed.
   */
  save(input: RoutineDraftInput & { id?: string | undefined }, now: number): Routine {
    const draft = RoutineDraft.parse(input);
    const existing = input.id === undefined ? null : this.get(input.id);
    if (input.id !== undefined && existing === null) throw new Error(`no routine '${input.id}'`);
    const routine = Routine.parse({
      ...draft,
      id: existing?.routine.id ?? randomUUID(),
      createdAt: existing?.routine.createdAt ?? iso(now),
    });
    const json = JSON.stringify(routine);
    if (existing === null) {
      this.db
        .prepare('INSERT INTO routines (id, json, last_due_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(routine.id, json, iso(now), iso(now));
    } else {
      const restart = JSON.stringify(existing.routine.when) !== JSON.stringify(routine.when);
      this.db
        .prepare(
          `UPDATE routines SET json = ?, updated_at = ?,
             last_due_at = CASE WHEN ? THEN ? ELSE last_due_at END WHERE id = ?`,
        )
        .run(json, iso(now), restart ? 1 : 0, iso(now), routine.id);
    }
    return routine;
  }

  /** Off, or on again; on again starts from now, so nothing missed while off runs. */
  setEnabled(id: string, enabled: boolean, now: number): Routine | null {
    const stored = this.get(id);
    if (stored === null) return null;
    const routine = { ...stored.routine, enabled };
    this.db
      .prepare(
        `UPDATE routines SET json = ?, updated_at = ?,
           last_due_at = CASE WHEN ? THEN ? ELSE last_due_at END WHERE id = ?`,
      )
      .run(JSON.stringify(routine), iso(now), enabled ? 1 : 0, iso(now), id);
    return routine;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM routines WHERE id = ?').run(id).changes > 0;
  }

  /** The schedule slot is handled: written before the run starts, so it never runs twice. */
  markDue(id: string, slot: number): void {
    this.db.prepare('UPDATE routines SET last_due_at = ? WHERE id = ?').run(iso(slot), id);
  }

  runStarted(id: string, at: number, activityId: string): void {
    this.db
      .prepare(
        `UPDATE routines SET last_run_at = ?, last_state = 'running', last_activity_id = ?
         WHERE id = ?`,
      )
      .run(iso(at), activityId, id);
  }

  runFinished(id: string, state: 'done' | 'error'): void {
    this.db.prepare('UPDATE routines SET last_state = ? WHERE id = ?').run(state, id);
  }

  /** At boot: a run still marked running was cut short by a crash or a quit. */
  interrupted(): void {
    this.db.prepare("UPDATE routines SET last_state = 'error' WHERE last_state = 'running'").run();
  }
}
