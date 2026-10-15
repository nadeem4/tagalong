import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureExclusions } from '@tagalong/protocol';
import { migrate } from './db';
import { SightLog } from './sight-log';

let db: Database.Database;
let now: Date;
let days: number;
let exclusions: CaptureExclusions;

function log(): SightLog {
  return new SightLog(db, {
    days: () => days,
    exclusions: () => exclusions,
    now: () => now,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  now = new Date('2026-10-14T09:00:00.000Z');
  days = 7;
  exclusions = { processNames: [], titlePatterns: [] };
});

afterEach(() => db.close());

describe('SightLog', () => {
  it('records rows and lists them newest first', () => {
    const sight = log();
    sight.record({ kind: 'listed_windows', windows: 12 });
    now = new Date('2026-10-14T09:01:00.000Z');
    sight.record({
      kind: 'read_text',
      app: 'Code.exe',
      title: 'main.ts',
      chars: 812,
      source: 'uia',
    });

    const entries = sight.list();
    expect(entries.map((e) => e.kind)).toEqual(['read_text', 'listed_windows']);
    expect(entries[0]).toMatchObject({
      app: 'Code.exe',
      title: 'main.ts',
      chars: 812,
      source: 'uia',
      at: '2026-10-14T09:01:00.000Z',
    });
    expect(entries[1]).toMatchObject({ windows: 12 });
    expect(entries[1]).not.toHaveProperty('app');
  });

  it('keeps the brain and the expert a send went to', () => {
    const sight = log();
    sight.record({
      kind: 'sent_to_ai',
      providerId: 'anthropic',
      model: 'haiku',
      chars: 40,
      images: 1,
    });
    sight.record({ kind: 'sent_to_expert', expertName: 'Coder', chars: 300 });
    expect(sight.list()).toMatchObject([
      { kind: 'sent_to_expert', expertName: 'Coder', chars: 300 },
      { kind: 'sent_to_ai', providerId: 'anthropic', model: 'haiku', images: 1 },
    ]);
  });

  it('deletes one row, and says whether it was there', () => {
    const sight = log();
    sight.record({ kind: 'screenshot', images: 1 });
    sight.record({ kind: 'screenshot', images: 2 });
    const [first] = sight.list();
    expect(sight.delete(first!.id)).toBe(true);
    expect(sight.delete(first!.id)).toBe(false);
    expect(sight.list().map((e) => e.images)).toEqual([1]);
  });

  it('clears every row and counts them', () => {
    const sight = log();
    sight.record({ kind: 'screenshot', images: 1 });
    sight.record({ kind: 'listed_windows', windows: 3 });
    expect(sight.clear()).toBe(2);
    expect(sight.list()).toEqual([]);
  });

  it('prunes rows older than the days kept, on insert and on demand', () => {
    const sight = log();
    now = new Date('2026-10-01T09:00:00.000Z');
    sight.record({ kind: 'screenshot', images: 1 });
    now = new Date('2026-10-10T09:00:00.000Z');
    sight.record({ kind: 'listed_windows', windows: 3 });
    // The October 1st row is nine days old by now: the insert dropped it.
    expect(sight.list().map((e) => e.kind)).toEqual(['listed_windows']);

    days = 1;
    now = new Date('2026-10-12T09:00:00.000Z');
    expect(sight.prune()).toBe(1);
    expect(sight.list()).toEqual([]);
  });

  it('hides a secret in a title', () => {
    const sight = log();
    const key = 'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    sight.record({ kind: 'read_text', app: 'Code.exe', title: `notes ${key}`, chars: 10 });
    const [entry] = sight.list();
    expect(entry?.title).not.toContain(key);
    expect(entry?.title).toContain('notes');
  });

  it('stores only the app for a blind spot or an excluded window', () => {
    exclusions = { processNames: [], titlePatterns: ['*Payroll*'] };
    const sight = log();
    sight.record({ kind: 'screenshot', app: '1Password.exe', title: 'Bank login', images: 1 });
    sight.record({ kind: 'read_text', app: 'Excel.exe', title: 'Payroll 2026.xlsx', chars: 5 });
    sight.record({ kind: 'read_text', app: 'Code.exe', title: '.env - repo', chars: 5 });
    for (const entry of sight.list()) expect(entry).not.toHaveProperty('title');
    expect(sight.list().map((e) => e.app)).toEqual(['Code.exe', 'Excel.exe', '1Password.exe']);
  });

  it('has no column that could hold text, pixels or a brief', () => {
    const columns = db
      .prepare<[], { name: string }>('PRAGMA table_info(sight_log)')
      .all()
      .map((c) => c.name)
      .sort();
    expect(columns).toEqual([
      'app',
      'at',
      'chars',
      'expert_name',
      'id',
      'images',
      'kind',
      'model',
      'provider_id',
      'source',
      'title',
      'windows',
    ]);
  });
});
