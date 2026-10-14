import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ActivityEntry } from '@tagalong/protocol';
import type { ActivityKind, ActivityListResult, ActivityState } from '@tagalong/protocol';
import type { ConnectorResult } from '../experts/connector';
import type { TurnEvent } from '../conversation/runner';
import type { ConversationStore } from './store';

/** A pasted file stays readable in Home without filling the table. */
export const ACTIVITY_TEXT_CHARS = 4_000;

interface ActivityRow {
  id: string;
  kind: string;
  state: string;
  pet_id: string;
  to_pet_id: string | null;
  turn_id: string | null;
  conversation_id: string | null;
  run_id: string | null;
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
}

interface NewEntry {
  kind: ActivityKind;
  petId: string;
  toPetId?: string | undefined;
  turnId?: string | undefined;
  conversationId?: string | undefined;
  runId?: string | undefined;
  providerId?: string | undefined;
  model?: string | undefined;
  text?: string | undefined;
}

function clip(text: string | undefined): string | null {
  if (text === undefined) return null;
  return text.length <= ACTIVITY_TEXT_CHARS ? text : `${text.slice(0, ACTIVITY_TEXT_CHARS - 1)}…`;
}

/**
 * The durable record behind Home's activity view: every turn, consult, handoff and
 * roundtable, written from the notifications the engine already sends (`observe` sits in
 * front of the broadcast) plus one hook for a consult's answer, which no notification
 * carries in full. Rows live in the `activity` table (migration 7) and survive a restart.
 */
export class ActivityLog {
  constructor(
    private readonly db: Database.Database,
    private readonly store: ConversationStore,
  ) {}

  observe(event: TurnEvent): void {
    switch (event.method) {
      case 'turn.started': {
        const { turnId, petId, conversationId, providerId, model, runId } = event.params;
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
          runId,
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
        this.#finishHandoff(turnId, state);
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
        this.#finishHandoff(turnId, 'error');
        return;
      }
      case 'pet.message': {
        const { kind, fromPetId, toPetId, text, turnId, conversationId, runId } = event.params;
        if (kind === 'roundtable') {
          // One row per run: the first round marker opens it, later ones only name rounds.
          if (runId === undefined || this.#hasRun(runId)) return;
          this.#insert({ kind: 'roundtable', petId: fromPetId, runId });
          return;
        }
        this.#insert({ kind, petId: fromPetId, toPetId, turnId, conversationId, text });
        return;
      }
      case 'crew.status': {
        const { runId, state, modelCalls } = event.params;
        this.db
          .prepare(
            `UPDATE activity SET state = ?, model_calls = ?, finished_at = ?
             WHERE run_id = ? AND kind = 'roundtable'`,
          )
          .run(state, modelCalls, state === 'running' ? null : now(), runId);
        return;
      }
      default:
        return;
    }
  }

  /** The consulted pet's reply, or why there was none, on the oldest open consult. */
  consultAnswered(turnId: string, toPetId: string, outcome: { ok: boolean; text: string }): void {
    const row = this.db
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM activity WHERE kind = 'consult' AND state = 'running'
         AND turn_id = ? AND to_pet_id = ? ORDER BY rowid ASC LIMIT 1`,
      )
      .get(turnId, toPetId);
    if (row === undefined) return;
    this.db
      .prepare(`UPDATE activity SET state = ?, answer = ?, error = ?, finished_at = ? WHERE id = ?`)
      .run(
        outcome.ok ? 'done' : 'error',
        outcome.ok ? clip(outcome.text) : null,
        outcome.ok ? null : clip(outcome.text),
        now(),
        row.id,
      );
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

  /**
   * The hand-offs that finished well after `since`, oldest first, at most five: what the
   * greeting may mention. The brief is the only text kept; the answer stays in Home.
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
        'SELECT * FROM activity WHERE rowid < ? ORDER BY rowid DESC LIMIT ?',
      )
      .all(cursor ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const entries = rows.slice(0, limit).map(toEntry);
    const last = entries.at(-1);
    return rows.length > limit && last !== undefined ? { entries, next: last.id } : { entries };
  }

  #insert(entry: NewEntry): void {
    this.db
      .prepare(
        `INSERT INTO activity (id, kind, state, pet_id, to_pet_id, turn_id, conversation_id,
           run_id, provider_id, model, text, started_at)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entry.kind,
        entry.petId,
        entry.toPetId ?? null,
        entry.turnId ?? null,
        entry.conversationId ?? null,
        entry.runId ?? null,
        entry.providerId ?? null,
        entry.model ?? null,
        clip(entry.text),
        now(),
      );
  }

  #hasRun(runId: string): boolean {
    return (
      this.db
        .prepare<[string], { id: string }>(
          "SELECT id FROM activity WHERE run_id = ? AND kind = 'roundtable'",
        )
        .get(runId) !== undefined
    );
  }

  /** A handoff is done when the turn it started is. */
  #finishHandoff(turnId: string, state: ActivityState): void {
    this.db
      .prepare(
        `UPDATE activity SET state = ?, finished_at = ?
         WHERE turn_id = ? AND kind = 'handoff' AND state = 'running'`,
      )
      .run(state, now(), turnId);
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
    ...optional('toPetId', row.to_pet_id),
    ...optional('turnId', row.turn_id),
    ...optional('conversationId', row.conversation_id),
    ...optional('runId', row.run_id),
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
    ...(row.changed_files === null
      ? {}
      : { changedFiles: JSON.parse(row.changed_files) as unknown }),
    startedAt: row.started_at,
    ...optional('finishedAt', row.finished_at),
  });
}
