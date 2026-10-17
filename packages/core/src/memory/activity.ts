/**
 * The Activity log behind Home: turns, hand-offs, app calls and routine runs in the activity
 * table, plus the queries Now, check-ins, pick-up and the daily briefing read.
 * Contains ActivityLog.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ActivityEntry, ActivityKind } from '@tagalong/protocol';
import type { ActivityListResult, ActivityState } from '@tagalong/protocol';
import type { ConnectorResult } from '../experts/connector';
import type { TurnEvent } from '../conversation/runner';
import type { ConversationStore } from './store';

/** A pasted file stays readable in Home without filling the table. */
export const ACTIVITY_TEXT_CHARS = 4_000;

/** The error on a row a crash or a quit left running. */
const INTERRUPTED = 'Interrupted: Tagalong closed before this finished.';

/**
 * The kinds the list shows. Older databases also hold consult, handoff and roundtable
 * rows; they stay on disk and out of the list.
 */
const LISTED = ActivityKind.options.map((kind) => `'${kind}'`).join(', ');

interface ActivityRow {
  id: string;
  kind: string;
  state: string;
  pet_id: string;
  turn_id: string | null;
  conversation_id: string | null;
  provider_id: string | null;
  model: string | null;
  text: string | null;
  answer: string | null;
  error: string | null;
  model_calls: number | null;
  started_at: string;
  finished_at: string | null;
  expert_id: string | null;
  expert_name: string | null;
  changed_files: string | null;
  app: string | null;
  tool: string | null;
  access: string | null;
  routine_id: string | null;
}

interface NewEntry {
  kind: ActivityKind;
  petId: string;
  turnId?: string | undefined;
  conversationId?: string | undefined;
  providerId?: string | undefined;
  model?: string | undefined;
  text?: string | undefined;
}

function clip(text: string | undefined): string | null {
  if (text === undefined) return null;
  return text.length <= ACTIVITY_TEXT_CHARS ? text : `${text.slice(0, ACTIVITY_TEXT_CHARS - 1)}…`;
}

/**
 * The durable record behind Home's activity view: every turn, written from the
 * notifications the engine already sends (`observe` sits in front of the broadcast), and
 * every hand-off to an expert, app call and routine run, written by their own hooks. Rows
 * live in the `activity` table (migration 7) and survive a restart.
 */
export class ActivityLog {
  constructor(
    private readonly db: Database.Database,
    private readonly store: ConversationStore,
  ) {}

  observe(event: TurnEvent): void {
    switch (event.method) {
      case 'turn.started': {
        const { turnId, petId, conversationId, providerId, model } = event.params;
        // The runner stores the question before it announces the turn.
        const last = this.store.lastMessages(conversationId, 1)[0];
        const question =
          last?.role === 'user'
            ? last.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
            : undefined;
        this.#insert({
          kind: 'turn',
          petId,
          turnId,
          conversationId,
          providerId,
          model,
          text: question,
        });
        return;
      }
      case 'turn.completed': {
        const { turnId, text, stopReason, modelCalls } = event.params;
        const state: ActivityState = stopReason === 'aborted' ? 'stopped' : 'done';
        this.db
          .prepare(
            `UPDATE activity SET state = ?, answer = ?, model_calls = ?, finished_at = ?
             WHERE turn_id = ? AND kind = 'turn' AND state = 'running'`,
          )
          .run(state, clip(text.length > 0 ? text : undefined), modelCalls ?? null, now(), turnId);
        return;
      }
      case 'turn.error': {
        const { turnId, message } = event.params;
        this.db
          .prepare(
            `UPDATE activity SET state = 'error', error = ?, finished_at = ?
             WHERE turn_id = ? AND kind = 'turn' AND state = 'running'`,
          )
          .run(clip(message), now(), turnId);
        return;
      }
      default:
        return;
    }
  }

  /** A companion handed a brief to an expert. Returns the entry's id, for `expertFinished`. */
  expertStarted(entry: {
    petId: string;
    expertId: string;
    expertName: string;
    text: string;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO activity (id, kind, state, pet_id, expert_id, expert_name, text, started_at)
         VALUES (?, 'expert', 'running', ?, ?, ?, ?, ?)`,
      )
      .run(id, entry.petId, entry.expertId, entry.expertName, clip(entry.text), now());
    return id;
  }

  /** What the expert was told, again: the brief with the notes passed on while it worked. */
  expertBriefed(id: string, text: string): void {
    this.db
      .prepare(`UPDATE activity SET text = ? WHERE id = ? AND kind = 'expert'`)
      .run(clip(text), id);
  }

  /** The expert's answer, or why there was none. A cancel is `stopped` and keeps no error. */
  expertFinished(id: string, result: ConnectorResult, state?: 'stopped'): void {
    const done = state ?? (result.ok ? 'done' : 'error');
    this.db
      .prepare(
        `UPDATE activity SET state = ?, answer = ?, error = ?, changed_files = ?, finished_at = ?
         WHERE id = ? AND kind = 'expert'`,
      )
      .run(
        done,
        result.ok ? clip(result.text) : null,
        !result.ok && done === 'error' ? clip(result.error) : null,
        result.ok && result.changedFiles.length > 0 ? JSON.stringify(result.changedFiles) : null,
        now(),
        id,
      );
  }

  /**
   * One call to a connected app, written once it is over. Only which app, which tool, read
   * or write, and how it ended: what went in and what came back are never kept.
   */
  connectorCalled(entry: {
    petId: string;
    turnId?: string | undefined;
    app: string;
    tool: string;
    access: 'read' | 'write';
    state: 'done' | 'error' | 'stopped';
    error?: string | undefined;
  }): void {
    const at = now();
    this.db
      .prepare(
        `INSERT INTO activity (id, kind, state, pet_id, turn_id, app, tool, access, error,
           started_at, finished_at)
         VALUES (?, 'connector', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.state,
        entry.petId,
        entry.turnId ?? null,
        entry.app,
        entry.tool,
        entry.access,
        entry.state === 'error' ? clip(entry.error) : null,
        at,
        at,
      );
  }

  /** A routine started a run. Returns the entry's id, for `routineFinished`. */
  routineStarted(entry: { routineId: string; petId: string; name: string }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO activity (id, kind, state, pet_id, routine_id, text, started_at)
         VALUES (?, 'routine', 'running', ?, ?, ?, ?)`,
      )
      .run(id, entry.petId, entry.routineId, clip(entry.name), now());
    return id;
  }

  /** How a routine run ended, with its answer and the conversation it is in. */
  routineFinished(
    id: string,
    outcome: {
      state: 'done' | 'error';
      answer?: string | undefined;
      error?: string | undefined;
      conversationId?: string | undefined;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE activity SET state = ?, answer = ?, error = ?, conversation_id = ?, finished_at = ?
         WHERE id = ? AND kind = 'routine'`,
      )
      .run(
        outcome.state,
        clip(outcome.answer),
        clip(outcome.error),
        outcome.conversationId ?? null,
        now(),
        id,
      );
  }

  /**
   * At boot, before anything runs: a row still `running` belongs to a run that a crash or
   * a quit cut short, so it would otherwise spin forever. Returns how many were closed.
   */
  interrupted(): number {
    return this.db
      .prepare(
        `UPDATE activity SET state = 'error', error = ?, finished_at = ? WHERE state = 'running'`,
      )
      .run(INTERRUPTED, now()).changes;
  }

  /**
   * The hand-offs that finished well after `since`, oldest first, at most five: what the
   * Now may mention. The brief is the only text kept; the answer stays in Home.
   */
  expertsFinishedSince(since: string): { expertName: string; text: string }[] {
    return this.db
      .prepare<[string], { expert_name: string | null; text: string | null }>(
        `SELECT expert_name, text FROM activity
         WHERE kind = 'expert' AND state = 'done' AND finished_at > ?
         ORDER BY finished_at ASC LIMIT 5`,
      )
      .all(since)
      .map((row) => ({ expertName: row.expert_name ?? 'An expert', text: row.text ?? '' }));
  }

  /**
   * The hand-offs that ended stopped or failed after `since` (an interrupted run included),
   * oldest first, at most three: for a pick-up. Only the ask, the first part of the brief;
   * the selected text and the window it carried are left out.
   */
  expertsLeftSince(since: string): {
    expertId: string;
    expertName: string;
    ask: string;
    state: 'stopped' | 'error';
  }[] {
    return this.db
      .prepare<
        [string],
        {
          expert_id: string | null;
          expert_name: string | null;
          text: string | null;
          state: 'stopped' | 'error';
        }
      >(
        `SELECT expert_id, expert_name, text, state FROM activity
         WHERE kind = 'expert' AND state IN ('stopped', 'error') AND finished_at > ?
         ORDER BY finished_at ASC LIMIT 3`,
      )
      .all(since)
      .flatMap((row) => {
        const ask = (row.text ?? '').split('\n\n')[0]?.trim() ?? '';
        if (row.expert_id === null || ask === '') return [];
        return [
          {
            expertId: row.expert_id,
            expertName: row.expert_name ?? 'An expert',
            ask,
            state: row.state,
          },
        ];
      });
  }

  /** When this pet's latest turn started, or null before its first: "You last talked". */
  lastTurnAt(petId: string): string | null {
    const row = this.db
      .prepare<[string], { at: string | null }>(
        `SELECT MAX(started_at) AS at FROM activity WHERE kind = 'turn' AND pet_id = ?`,
      )
      .get(petId);
    return row?.at ?? null;
  }

  /** This pet's latest answered question and its answer (clipped as stored): for check-ins. */
  lastExchange(petId: string): { said: string; answered: string } | null {
    const row = this.db
      .prepare<[string], { text: string; answer: string }>(
        `SELECT text, answer FROM activity
         WHERE kind = 'turn' AND pet_id = ? AND answer IS NOT NULL AND text IS NOT NULL
         ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get(petId);
    return row === undefined ? null : { said: row.text, answered: row.answer };
  }

  /** A hand-off's expert and what it was asked, by its id: for its check-in. */
  expertEntry(id: string): { expertName: string; ask: string } | null {
    const row = this.db
      .prepare<[string], { expert_name: string | null; text: string | null }>(
        `SELECT expert_name, text FROM activity WHERE id = ? AND kind = 'expert'`,
      )
      .get(id);
    return row === undefined
      ? null
      : { expertName: row.expert_name ?? 'An expert', ask: row.text ?? '' };
  }

  /** The routines that ran well after `since`, oldest first, at most five: their names only. */
  routinesFinishedSince(since: string): string[] {
    return this.db
      .prepare<[string], { text: string | null }>(
        `SELECT text FROM activity
         WHERE kind = 'routine' AND state = 'done' AND finished_at > ?
         ORDER BY finished_at ASC LIMIT 5`,
      )
      .all(since)
      .map((row) => row.text ?? 'A routine');
  }

  /**
   * The rows Home shows that started at or after `startIso` and before `untilIso`, oldest
   * first, at most `limit`: what the daily briefing reads. Answers come back too; the
   * briefing leaves them out.
   */
  since(startIso: string, limit = 200, untilIso = '9999'): ActivityEntry[] {
    return this.db
      .prepare<[string, string, number], ActivityRow>(
        `SELECT * FROM activity WHERE started_at >= ? AND started_at < ? AND kind IN (${LISTED})
         ORDER BY started_at ASC, rowid ASC LIMIT ?`,
      )
      .all(startIso, untilIso, limit)
      .map(toEntry);
  }

  /** Newest first; `before` is the `next` of the page before. */
  list(params: { before?: string | undefined; limit?: number | undefined }): ActivityListResult {
    const limit = params.limit ?? 30;
    const cursor =
      params.before === undefined
        ? undefined
        : this.db
            .prepare<[string], { rowid: number }>('SELECT rowid FROM activity WHERE id = ?')
            .get(params.before)?.rowid;
    const rows = this.db
      .prepare<[number, number], ActivityRow>(
        `SELECT * FROM activity WHERE rowid < ? AND kind IN (${LISTED})
         ORDER BY rowid DESC LIMIT ?`,
      )
      .all(cursor ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const entries = rows.slice(0, limit).map(toEntry);
    const last = entries.at(-1);
    return rows.length > limit && last !== undefined ? { entries, next: last.id } : { entries };
  }

  #insert(entry: NewEntry): void {
    this.db
      .prepare(
        `INSERT INTO activity (id, kind, state, pet_id, turn_id, conversation_id, provider_id,
           model, text, started_at)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.kind,
        entry.petId,
        entry.turnId ?? null,
        entry.conversationId ?? null,
        entry.providerId ?? null,
        entry.model ?? null,
        clip(entry.text),
        now(),
      );
  }
}

function now(): string {
  return new Date().toISOString();
}

function toEntry(row: ActivityRow): ActivityEntry {
  const optional = (key: string, value: string | number | null) =>
    value === null ? {} : { [key]: value };
  return ActivityEntry.parse({
    id: row.id,
    kind: row.kind,
    state: row.state,
    petId: row.pet_id,
    ...optional('turnId', row.turn_id),
    ...optional('conversationId', row.conversation_id),
    ...optional('providerId', row.provider_id),
    ...optional('model', row.model),
    ...optional('text', row.text),
    ...optional('answer', row.answer),
    ...optional('error', row.error),
    ...optional('modelCalls', row.model_calls),
    ...optional('expertId', row.expert_id),
    ...optional('expertName', row.expert_name),
    ...optional('app', row.app),
    ...optional('tool', row.tool),
    ...optional('access', row.access),
    ...optional('routineId', row.routine_id),
    ...(row.changed_files === null
      ? {}
      : { changedFiles: JSON.parse(row.changed_files) as unknown }),
    startedAt: row.started_at,
    ...optional('finishedAt', row.finished_at),
  });
}
