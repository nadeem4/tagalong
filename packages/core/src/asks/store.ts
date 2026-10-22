/**
 * The asks table (migration 25): one row per thing that waits on the person. Contains
 * AskStore, the row shape AskRecord and the limits on what an answered row keeps.
 */
import type Database from 'better-sqlite3';
import type { AskKind, AskNote, AskRisk, AskState } from '@tagalong/protocol';
import { hideSecrets } from '../privacy/secrets';

/** Answered asks are the audit trail for this many days; waiting asks are never pruned. */
export const ASK_KEEP_DAYS = 30;

/** Once answered, an ask keeps only the first line of its summary, cut to this. */
export const ANSWERED_SUMMARY_CHARS = 120;

export interface AskRecord {
  id: string;
  kind: AskKind;
  petId: string;
  summary: string;
  risk: AskRisk;
  app?: string;
  tool?: string;
  expertId?: string;
  /** The turn that asked, which is its episode's ref. */
  originTurnId?: string;
  /** What a hand-off card needs to be sent after a restart. Gone once answered. */
  payload?: unknown;
  state: AskState;
  answeredBy?: 'you' | 'rule';
  note?: AskNote;
  createdAt: string;
  expiresAt?: string;
  answeredAt?: string;
}

export type NewAsk = Omit<AskRecord, 'state' | 'answeredBy' | 'note' | 'answeredAt'>;

interface AskRow {
  id: string;
  kind: string;
  pet_id: string;
  summary: string;
  risk: string;
  app: string | null;
  tool: string | null;
  expert_id: string | null;
  origin_turn_id: string | null;
  payload_json: string | null;
  state: string;
  answered_by: string | null;
  note: string | null;
  created_at: string;
  expires_at: string | null;
  answered_at: string | null;
}

/**
 * Saved asks. `settle` is the only way out of `waiting`, and only one settle wins, so a
 * card and Home answering at once cannot both. A settled row keeps a short first line of
 * its summary and no payload.
 */
export class AskStore {
  constructor(private readonly db: Database.Database) {}

  insert(ask: NewAsk): void {
    this.db
      .prepare(
        `INSERT INTO asks (id, kind, pet_id, summary, risk, app, tool, expert_id, origin_turn_id,
           payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ask.id,
        ask.kind,
        ask.petId,
        hideSecrets(ask.summary),
        ask.risk,
        ask.app ?? null,
        ask.tool ?? null,
        ask.expertId ?? null,
        ask.originTurnId ?? null,
        ask.payload === undefined ? null : JSON.stringify(ask.payload),
        ask.createdAt,
        ask.expiresAt ?? null,
      );
  }

  /** True when this call moved the ask out of `waiting`; false when it was already answered. */
  settle(
    id: string,
    state: Exclude<AskState, 'waiting'>,
    how: { by?: 'you'; note?: AskNote; at?: string } = {},
  ): boolean {
    const row = this.get(id);
    if (row?.state !== 'waiting') return false;
    return (
      this.db
        .prepare(
          `UPDATE asks SET state = ?, answered_by = ?, note = ?, answered_at = ?, summary = ?,
             payload_json = NULL
           WHERE id = ? AND state = 'waiting'`,
        )
        .run(
          state,
          how.by ?? null,
          how.note ?? null,
          how.at ?? new Date().toISOString(),
          firstLine(row.summary),
          id,
        ).changes === 1
    );
  }

  get(id: string): AskRecord | null {
    const row = this.db.prepare<[string], AskRow>('SELECT * FROM asks WHERE id = ?').get(id);
    return row === undefined ? null : toRecord(row);
  }

  /** What waits, oldest first. */
  waiting(): AskRecord[] {
    return this.db
      .prepare<[], AskRow>(`SELECT * FROM asks WHERE state = 'waiting' ORDER BY created_at, rowid`)
      .all()
      .map(toRecord);
  }

  /** The last answered, newest first. */
  recent(limit = 20): AskRecord[] {
    return this.db
      .prepare<[number], AskRow>(
        `SELECT * FROM asks WHERE state <> 'waiting' ORDER BY answered_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit)
      .map(toRecord);
  }

  /** Forgets answered asks older than ASK_KEEP_DAYS. A waiting ask is never pruned. */
  prune(now = Date.now()): number {
    const cutoff = new Date(now - ASK_KEEP_DAYS * 86_400_000).toISOString();
    return this.db
      .prepare(`DELETE FROM asks WHERE state <> 'waiting' AND answered_at < ?`)
      .run(cutoff).changes;
  }

  /** Delete all: every answered ask. What still waits stays, so its card still works. */
  clear(): number {
    return this.db.prepare(`DELETE FROM asks WHERE state <> 'waiting'`).run().changes;
  }
}

/** The first line with words in it, secrets hidden, cut to ANSWERED_SUMMARY_CHARS. */
function firstLine(summary: string): string {
  const line = hideSecrets(
    summary
      .split('\n')
      .find((part) => part.trim() !== '')
      ?.trim() ?? summary,
  );
  return line.length <= ANSWERED_SUMMARY_CHARS
    ? line
    : `${line.slice(0, ANSWERED_SUMMARY_CHARS - 1)}…`;
}

function toRecord(row: AskRow): AskRecord {
  return {
    id: row.id,
    kind: row.kind as AskKind,
    petId: row.pet_id,
    summary: row.summary,
    risk: row.risk as AskRisk,
    ...(row.app === null ? {} : { app: row.app }),
    ...(row.tool === null ? {} : { tool: row.tool }),
    ...(row.expert_id === null ? {} : { expertId: row.expert_id }),
    ...(row.origin_turn_id === null ? {} : { originTurnId: row.origin_turn_id }),
    ...(row.payload_json === null ? {} : { payload: JSON.parse(row.payload_json) as unknown }),
    state: row.state as AskState,
    ...(row.answered_by === null ? {} : { answeredBy: row.answered_by as 'you' | 'rule' }),
    ...(row.note === null ? {} : { note: row.note as AskNote }),
    createdAt: row.created_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.answered_at === null ? {} : { answeredAt: row.answered_at }),
  };
}
