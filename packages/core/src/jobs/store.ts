/**
 * The `jobs` table (migration 21): one row per job of Scout's, or per memory digest run
 * (`kind = 'digest'`, shown on the board). Times are passed in.
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
  /** When a check-in line about it was shown; null: not mentioned yet. */
  reportedAt: string | null;
}

const COLUMNS = `id, kind, state, pet_id AS petId, task, dedupe_key AS dedupeKey,
  conversation_id AS conversationId, note, error, created_at AS createdAt,
  started_at AS startedAt, finished_at AS finishedAt, reported_at AS reportedAt`;
const LIVE = `state IN ('queued', 'running')`;
const NEWEST = 'ORDER BY created_at DESC, rowid DESC';
const JOB = `kind = 'job'`;
const INTERRUPTED = 'Interrupted: Tagalong closed before this finished.';

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

  /** A digest run: running from the start, with no conversation. */
  startDigest(run: { id: string; petId: string; at: string }): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, state, pet_id, task, dedupe_key, created_at, started_at)
         VALUES (?, 'digest', 'running', ?, 'Tidy memory', '', ?, ?)`,
      )
      .run(run.id, run.petId, run.at, run.at);
  }

  /** Digest runs started at or after `sinceIso`, newest first. */
  digests(sinceIso: string): JobRow[] {
    return this.#rows(`WHERE kind = 'digest' AND created_at >= ? ${NEWEST}`, sinceIso);
  }

  /** Jobs that finished well and the digest has not read yet, newest first. */
  undigested(limit: number): JobRow[] {
    return this.#rows(
      `WHERE ${JOB} AND state = 'done' AND digested_at IS NULL ${NEWEST} LIMIT ?`,
      String(limit),
    );
  }

  markDigested(ids: readonly string[], at: string): void {
    const mark = this.db.prepare('UPDATE jobs SET digested_at = ? WHERE id = ?');
    this.db.transaction(() => ids.forEach((id) => mark.run(at, id)))();
  }

  /** Jobs that finished well at or after `sinceIso`, newest first, at most 300: for recall. */
  doneSince(sinceIso: string): JobRow[] {
    return this.#rows(
      `WHERE ${JOB} AND state = 'done' AND finished_at >= ? ${NEWEST} LIMIT 300`,
      sinceIso,
    );
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

  /** A check-in line about these jobs was shown; a job already told keeps its first time. */
  markReported(ids: readonly string[], at: string): void {
    const mark = this.db.prepare(
      'UPDATE jobs SET reported_at = ? WHERE id = ? AND reported_at IS NULL',
    );
    for (const id of ids) mark.run(at, id);
  }

  get(id: string): JobRow | null {
    return this.#rows('WHERE id = ?', id)[0] ?? null;
  }

  /** Live jobs and those finished at or after `sinceIso`, newest first. */
  list(sinceIso: string): JobRow[] {
    return this.#rows(`WHERE ${LIVE} OR finished_at >= ? ${NEWEST}`, sinceIso);
  }

  latestByKey(dedupeKey: string): JobRow | null {
    return this.#rows(`WHERE ${JOB} AND dedupe_key = ? ${NEWEST} LIMIT 1`, dedupeKey)[0] ?? null;
  }

  /** Jobs created at or after `sinceIso`: the daily cap. */
  countSince(sinceIso: string): number {
    return this.#rows(`WHERE ${JOB} AND created_at >= ?`, sinceIso).length;
  }

  /** Finished jobs whose task shares a word with `query`, newest first: for `forget`. */
  search(query: string, limit: number): JobRow[] {
    const words = query.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
    return this.#rows(`WHERE ${JOB} AND NOT (${LIVE}) ${NEWEST} LIMIT 300`)
      .filter((row) => words.some((word) => row.task.toLowerCase().includes(word)))
      .slice(0, limit);
  }

  /** Finished jobs whose id (dashes left out) starts with `prefix`. */
  finishedByPrefix(prefix: string): JobRow[] {
    const hex = prefix.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex === '') return [];
    return this.#rows(
      `WHERE ${JOB} AND NOT (${LIVE}) AND replace(id, '-', '') LIKE ? || '%' LIMIT 3`,
      hex,
    );
  }

  /** Deletes a finished job with its conversation. False for a live or unknown one. */
  delete(id: string): boolean {
    return this.db.transaction(() => this.#remove(`id = ? AND NOT (${LIVE})`, id) > 0)();
  }

  /** At boot: a queued or running job was cut short. */
  interrupted(at: string): number {
    return this.db
      .prepare(`UPDATE jobs SET state = 'error', error = ?, finished_at = ? WHERE ${LIVE}`)
      .run(INTERRUPTED, at).changes;
  }

  /** Jobs finished before `beforeIso` go, with their conversations. */
  prune(beforeIso: string): number {
    return this.db.transaction(() =>
      this.#remove(`NOT (${LIVE}) AND finished_at < ?`, beforeIso),
    )();
  }

  #rows(where: string, ...params: string[]): JobRow[] {
    return this.db.prepare<string[], JobRow>(`SELECT ${COLUMNS} FROM jobs ${where}`).all(...params);
  }

  /** Deletes matching jobs and their conversations' messages; call inside a transaction. */
  #remove(where: string, param: string): number {
    const conversations = `(SELECT conversation_id FROM jobs WHERE ${where})`;
    this.db.prepare(`DELETE FROM messages WHERE conversation_id IN ${conversations}`).run(param);
    this.db.prepare(`DELETE FROM conversations WHERE id IN ${conversations}`).run(param);
    return this.db.prepare(`DELETE FROM jobs WHERE ${where}`).run(param).changes;
  }
}
