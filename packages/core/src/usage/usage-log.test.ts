/** Tests for UsageLog: rows, and the daily and monthly sums in the person's time zone. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../memory/db';
import { UsageLog } from './usage-log';

let db: Database.Database;
let now: number;
let zone: string;
let log: UsageLog;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  // 23:30 on 15 October in New York (UTC-4).
  now = Date.parse('2026-10-16T03:30:00Z');
  zone = 'America/New_York';
  log = new UsageLog(db, { now: () => now, timeZone: () => zone });
});

afterEach(() => db.close());

const scout = (providerId: string, model: string, inputTokens = 1000, outputTokens = 100) => ({
  source: 'scout' as const,
  providerId,
  model,
  inputTokens,
  outputTokens,
});

describe('UsageLog', () => {
  it('prices a row once, when it is written, and keeps counts only', () => {
    log.record(scout('anthropic', 'claude-haiku-4-5'));
    const row = db.prepare('SELECT * FROM usage').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      source: 'scout',
      provider_id: 'anthropic',
      model: 'claude-haiku-4-5',
      input_tokens: 1000,
      output_tokens: 100,
    });
    expect(row.cost_usd).toBeCloseTo(0.0015, 10);
    expect(Object.keys(row).sort()).toEqual(
      [
        'at',
        'cost_usd',
        'id',
        'input_tokens',
        'model',
        'output_tokens',
        'provider_id',
        'source',
      ].sort(),
    );
  });

  it('writes nothing for a call that used no tokens', () => {
    log.record(scout('anthropic', 'claude-haiku-4-5', 0, 0));
    expect(log.summary().month).toEqual([]);
  });

  it('groups by source and provider, today and this month, in the person’s zone', () => {
    // 22:00 local on the 15th: today. 01:00 local on the 1st: this month, not today.
    now = Date.parse('2026-10-16T02:00:00Z');
    log.record(scout('anthropic', 'claude-haiku-4-5'));
    now = Date.parse('2026-10-01T05:00:00Z');
    log.record(scout('anthropic', 'claude-haiku-4-5'));
    // 23:00 local on 30 September: last month, though it is October in UTC.
    now = Date.parse('2026-10-01T03:00:00Z');
    log.record(scout('anthropic', 'claude-haiku-4-5'));
    now = Date.parse('2026-10-16T03:00:00Z');
    log.record({ ...scout('claude-code', 'sonnet', 5000, 500), source: 'expert' });

    now = Date.parse('2026-10-16T03:30:00Z');
    const { today, month } = log.summary();
    expect(today).toEqual([
      {
        source: 'scout',
        providerId: 'anthropic',
        model: 'claude-haiku-4-5',
        inputTokens: 1000,
        outputTokens: 100,
        costUsd: expect.closeTo(0.0015, 10) as number,
        unpricedTokens: 0,
      },
      {
        source: 'expert',
        providerId: 'claude-code',
        model: 'sonnet',
        inputTokens: 5000,
        outputTokens: 500,
        costUsd: null,
        unpricedTokens: 5500,
      },
    ]);
    expect(month.find((row) => row.providerId === 'anthropic')?.inputTokens).toBe(2000);
  });

  it('moves to a new day at local midnight, not UTC midnight', () => {
    log.record(scout('anthropic', 'claude-haiku-4-5'));
    // 00:10 local on the 16th.
    now = Date.parse('2026-10-16T04:10:00Z');
    expect(log.summary().today).toEqual([]);
    expect(log.todayUsd()).toBe(0);
  });

  it('counts only priced dollars toward today', () => {
    log.record(scout('anthropic', 'claude-opus-5', 1_000_000, 0));
    log.record(scout('claude-code', 'opus', 9_000_000, 0));
    log.record(scout('openrouter', 'some/new-model', 9_000_000, 0));
    expect(log.todayUsd()).toBeCloseTo(5, 10);
    const openrouter = log.summary().today.find((row) => row.providerId === 'openrouter');
    expect(openrouter?.costUsd).toBeNull();
    expect(openrouter?.unpricedTokens).toBe(9_000_000);
  });
});
