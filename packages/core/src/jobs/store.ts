/**
 * The `jobs` table (migration 21): Scout's own background work, one row per job. Contains
 * `JobStore` and `JobRow`. Times are passed in, so the caller's clock decides them.
 */
import type Database from 'better-sqlite3';

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'stopped';

export interface JobRow {
  id: string;
  kind: 'job' | 'digest';
  state: JobState;
  petId: string;
  task: string;
  dedupeKey: string;
  conversationId: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reportedAt: string | null;
}

interface Row {
  id: string;
  kind: 'job' | 'digest';
  state: JobState;
  pet_id: string;
  task: string;
  dedupe_key: string;
  conversation_id: string | null;
  note: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  reported_at: string | null;
}

/** The error on a job a crash or a quit cut short (the same words as the activity log's). */
const INTERRUPTED = 'Interrupted: Tagalong closed before this finished.';

const LIVE = `state IN ('queued', 'running')`;

export class JobStore {
  constructor(private readonly db: Database.Database) {}

  insert(job: { id: string; petId: string; task: string; dedupeKey: string; at: string }): JobRow {
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, state, pet_id, task, dedupe_key, created_at)
         VALUES (?, 'job', 'queued', ?, ?, ?, ?)`,
      )
      .run(job.id, job.petId, job.task, job.dedupeKey, job.at);
    return this.get(job.id)!;
  }

  start(id: string, conversationId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET state = 'running', conversation_id = ?, started_at = ? WHERE id = ?`,
      )
      .run(conversationId, at, id);
  }

  finish(
    id: string,
    outcome: { state: 'done' | 'error' | 'stopped'; note?: string; error?: string },
    at: string,
  ): void {
    this.db
      .prepare(`UPDATE jobs SET state = ?, note = ?, error = ?, finished_at = ? WHERE id = ?`)
      .run(outcome.state, outcome.note ?? null, outcome.error ?? null, at, id);
  }

  get(id: string): JobRow | null {
    const row = this.db.prepare<[string], Row>('SELECT * FROM jobs WHERE id = ?').get(id);
    return row === undefined ? null : toJob(row);
  }

  /** Queued and running jobs, and those finished at or after `sinceIso`, newest first. */
  list(sinceIso: string): JobRow[] {
    return this.db
      .prepare<[string], Row>(
        `SELECT * FROM jobs WHERE kind = 'job' AND (${LIVE} OR finished_at >= ?)
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(sinceIso)
      .map(toJob);
  }

  /** The newest job with this dedupe key, whatever its state. */
  latestByKey(dedupeKey: string): JobRow | null {
    const row = this.db
      .prepare<[string], Row>(
        `SELECT * FROM jobs WHERE kind = 'job' AND dedupe_key = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(dedupeKey);
    return row === undefined ? null : toJob(row);
  }

  /** Jobs created at or after `sinceIso`: the daily cap counts these. */
  countSince(sinceIso: string): number {
    return (
      this.db
        .prepare<[string], { n: number }>(
          `SELECT COUNT(*) AS n FROM jobs WHERE kind = 'job' AND created_at >= ?`,
        )
        .get(sinceIso)?.n ?? 0
    );
  }

  /** At boot, before anything runs: a queued or running job was cut short. Returns how many. */
  interrupted(at: string): number {
    return this.db
      .prepare(`UPDATE jobs SET state = 'error', error = ?, finished_at = ? WHERE ${LIVE}`)
      .run(INTERRUPTED, at).changes;
  }

  /** Jobs finished before `beforeIso` go, with their conversations and messages. */
  prune(beforeIso: string): number {
    return this.db.transaction(() => {
      const where = `FROM jobs WHERE NOT (${LIVE}) AND finished_at < ?`;
      this.db
        .prepare(`DELETE FROM messages WHERE conversation_id IN (SELECT conversation_id ${where})`)
        .run(beforeIso);
      this.db
        .prepare(`DELETE FROM conversations WHERE id IN (SELECT conversation_id ${where})`)
        .run(beforeIso);
      return this.db.prepare(`DELETE ${where}`).run(beforeIso).changes;
    })();
  }
}

function toJob(row: Row): JobRow {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    petId: row.pet_id,
    task: row.task,
    dedupeKey: row.dedupe_key,
    conversationId: row.conversation_id,
    note: row.note,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    reportedAt: row.reported_at,
  };
}
