/**
 * `UsageLog`: one row per model call or expert run in the `usage` table, counts and price
 * only, summed by day and month in the person's time zone. Read by Home's Spend card.
 */
import type { Database } from 'better-sqlite3';
import type { UsageRow, UsageSource } from '@tagalong/protocol';
import { costUsd } from './prices';

export interface UsageEntry {
  source: UsageSource;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface Row {
  at: string;
  source: UsageSource;
  provider_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

/** Far enough back to hold all of this month in any zone. */
const MONTH_LOOKBACK_MS = 32 * 24 * 60 * 60 * 1000;

/**
 * The cost meter's record: one row per model call or expert run, counts only. The price
 * is worked out once, when the row is written, so a later price change never rewrites
 * what a past day cost.
 */
export class UsageLog {
  readonly #db: Database;
  readonly #clock: { now(): number; timeZone(): string };

  constructor(db: Database, clock: { now(): number; timeZone(): string }) {
    this.#db = db;
    this.#clock = clock;
  }

  record(entry: UsageEntry): void {
    if (entry.inputTokens === 0 && entry.outputTokens === 0) return;
    this.#db
      .prepare(
        `INSERT INTO usage (at, source, provider_id, model, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date(this.#clock.now()).toISOString(),
        entry.source,
        entry.providerId,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        costUsd(entry.providerId, entry.model, entry.inputTokens, entry.outputTokens),
      );
  }

  /** Today and this month, by source and provider, in the person's time zone. */
  summary(): { today: UsageRow[]; month: UsageRow[] } {
    const { today, month } = this.#periods();
    return { today: group(today), month: group(month) };
  }

  /** Today's priced dollars. Unpriced rows (unknown models, the Claude sign-in) add nothing. */
  todayUsd(): number {
    return this.#periods().today.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
  }

  #periods(): { today: Row[]; month: Row[] } {
    const now = this.#clock.now();
    const day = localDay(now, this.#clock.timeZone());
    const since = new Date(now - MONTH_LOOKBACK_MS).toISOString();
    const rows = this.#db
      .prepare<[string], Row>(
        `SELECT at, source, provider_id, model, input_tokens, output_tokens, cost_usd
         FROM usage WHERE at >= ? ORDER BY at`,
      )
      .all(since);
    const zone = this.#clock.timeZone();
    const month = rows.filter(
      (row) => localDay(Date.parse(row.at), zone).slice(0, 7) === day.slice(0, 7),
    );
    return { today: month.filter((row) => localDay(Date.parse(row.at), zone) === day), month };
  }
}

/** `YYYY-MM-DD` as the clock on the wall reads in `zone`. */
function localDay(at: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Rows in time order, folded into one per source and provider, in first-seen order. */
function group(rows: readonly Row[]): UsageRow[] {
  const groups = new Map<string, UsageRow>();
  for (const row of rows) {
    const key = `${row.source}\u0000${row.provider_id}`;
    const current = groups.get(key) ?? {
      source: row.source,
      providerId: row.provider_id,
      model: row.model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      unpricedTokens: 0,
    };
    current.model = row.model;
    current.inputTokens += row.input_tokens;
    current.outputTokens += row.output_tokens;
    if (row.cost_usd === null) current.unpricedTokens += row.input_tokens + row.output_tokens;
    else current.costUsd = (current.costUsd ?? 0) + row.cost_usd;
    groups.set(key, current);
  }
  return [...groups.values()];
}
