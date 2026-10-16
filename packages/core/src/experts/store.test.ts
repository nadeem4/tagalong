/** Tests for ExpertStore and migration 8 on older databases. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Expert } from '@tagalong/protocol';
import { LATEST_SCHEMA_VERSION, migrate } from '../memory/db';
import { ExpertStore } from './store';

let db: Database.Database;
let experts: ExpertStore;

const claudeCode = Expert.parse({
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code in this repo',
  connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
});

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  experts = new ExpertStore(db);
});

afterEach(() => db.close());

describe('ExpertStore', () => {
  it('starts empty', () => {
    expect(experts.list()).toEqual([]);
    expect(experts.get('claude-code')).toBeNull();
  });

  it('saves, reads back and replaces an expert', () => {
    experts.upsert(claudeCode);
    expect(experts.get('claude-code')).toEqual(claudeCode);
    const renamed = { ...claudeCode, name: 'Claude' };
    experts.upsert(renamed);
    expect(experts.list()).toEqual([renamed]);
  });

  it('keeps the order experts were added in', () => {
    experts.upsert({ ...claudeCode, id: 'b', name: 'B' });
    experts.upsert({ ...claudeCode, id: 'a', name: 'A' });
    expect(experts.list().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('deletes', () => {
    experts.upsert(claudeCode);
    expect(experts.delete('claude-code')).toBe(true);
    expect(experts.delete('claude-code')).toBe(false);
    expect(experts.list()).toEqual([]);
  });

  it('survives reopening the database', () => {
    experts.upsert(claudeCode);
    expect(new ExpertStore(db).list()).toEqual([claudeCode]);
  });
});

describe('migration 8', () => {
  it('runs again on a database rolled back past it', () => {
    db.prepare('DELETE FROM schema_version WHERE version >= 5').run();
    expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
    experts.upsert(claudeCode);
    expect(experts.list()).toHaveLength(1);
  });
});

describe('migration 8 on an install from before experts', () => {
  it('keeps every activity row and lets expert entries in', () => {
    // Put activity back the way migration 7 left it, with one row in it.
    db.exec(`DROP TABLE activity;
      CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('turn', 'consult', 'handoff', 'roundtable')),
        state TEXT NOT NULL, pet_id TEXT NOT NULL, to_pet_id TEXT, turn_id TEXT,
        conversation_id TEXT, run_id TEXT, provider_id TEXT, model TEXT, text TEXT,
        answer TEXT, error TEXT, model_calls INTEGER, started_at TEXT NOT NULL, finished_at TEXT
      );
      INSERT INTO activity (id, kind, state, pet_id, text, started_at)
        VALUES ('old', 'turn', 'done', 'scout', 'hello', '2026-10-01T00:00:00.000Z');`);
    db.prepare('DELETE FROM schema_version WHERE version >= 8').run();

    migrate(db);

    expect(db.prepare("SELECT text FROM activity WHERE id = 'old'").get()).toEqual({
      text: 'hello',
    });
    expect(() =>
      db
        .prepare(
          `INSERT INTO activity (id, kind, state, pet_id, expert_id, started_at)
           VALUES ('new', 'expert', 'running', 'scout', 'claude-code', '2026-10-09T00:00:00.000Z')`,
        )
        .run(),
    ).not.toThrow();
  });
});
