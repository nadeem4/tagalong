/** Tests for openDatabase and every migration, including upgrades of older databases. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { DB_FILENAME, LATEST_SCHEMA_VERSION, migrate, openDatabase } from './db';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-db-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
    .sort();
}

// These open a real file in a fresh temp dir: the first loads the SQLite native addon and every
// one runs all migrations with an fsync each. That takes ~30ms locally but has passed 5s on a
// loaded Windows runner with on-access scanning, so the bounded work gets an explicit allowance.
describe('openDatabase', { timeout: 20_000 }, () => {
  it('creates the database file inside the data dir', () => {
    const db = openDatabase(dataDir);
    try {
      expect(existsSync(join(dataDir, DB_FILENAME))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('migrates a fresh database to the latest version', () => {
    const db = openDatabase(dataDir);
    try {
      expect(tableNames(db)).toEqual([
        'activity',
        'activity_fts',
        'activity_fts_config',
        'activity_fts_data',
        'activity_fts_docsize',
        'activity_fts_idx',
        'connections',
        'conversations',
        'expert_routes',
        'experts',
        'memories',
        'memories_fts',
        'memories_fts_config',
        'memories_fts_data',
        'memories_fts_docsize',
        'memories_fts_idx',
        'messages',
        'pet_seeds',
        'pets',
        'pick_up',
        'projects',
        'routines',
        'schema_version',
        'sight_log',
        'sight_log_fts',
        'sight_log_fts_config',
        'sight_log_fts_data',
        'sight_log_fts_docsize',
        'sight_log_fts_idx',
        'usage',
      ]);
      const row = db
        .prepare<[], { version: number }>('SELECT MAX(version) AS version FROM schema_version')
        .get();
      expect(row?.version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('indexes messages by conversation and time', () => {
    const db = openDatabase(dataDir);
    try {
      const index = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'messages_conv'",
        )
        .get();
      expect(index?.name).toBe('messages_conv');
    } finally {
      db.close();
    }
  });
});

describe('migrate', () => {
  it('is a no-op when rerun on an already migrated database', () => {
    const db = new Database(':memory:');
    try {
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
        'scout',
        '{}',
        '2026-09-11T00:00:00.000Z',
      );

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const pets = db.prepare<[], { id: string }>('SELECT id FROM pets').all();
      expect(pets).toHaveLength(1);
      const applied = db
        .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_version')
        .get();
      expect(applied?.n).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('gives pets stored before roles a role in migration 5', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      // Roll the record back to version 4, as an install from before roles would be.
      db.prepare('DELETE FROM schema_version WHERE version >= 5').run();
      db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
        'pip',
        JSON.stringify({ id: 'pip', persona: 'You are Pip.', toolAllowlist: [] }),
        '2026-09-11T00:00:00.000Z',
      );

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const row = db.prepare<[], { json: string }>("SELECT json FROM pets WHERE id = 'pip'").get();
      expect(JSON.parse(row?.json ?? '{}')).toMatchObject({
        roleId: 'generalist',
        notes: 'You are Pip.',
      });
    } finally {
      db.close();
    }
  });

  it('removes Ink and Bolt in migration 11, keeping their conversations', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      db.prepare('DELETE FROM schema_version WHERE version >= 11').run();
      const add = db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)');
      for (const id of ['scout', 'ink', 'bolt', 'pip']) {
        add.run(id, JSON.stringify({ id }), '2026-10-01T00:00:00.000Z');
      }
      db.prepare(
        "INSERT INTO conversations (id, pet_id, created_at) VALUES ('c1', 'ink', 'x')",
      ).run();

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const ids = db
        .prepare<[], { id: string }>('SELECT id FROM pets ORDER BY id')
        .all()
        .map((row) => row.id);
      expect(ids).toEqual(['pip', 'scout']);
      expect(db.prepare("SELECT id FROM conversations WHERE id = 'c1'").get()).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('adds routines in migration 13, keeping every activity row and taking routine runs', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      db.prepare('DELETE FROM schema_version WHERE version >= 13').run();
      db.exec('DROP TABLE routines');
      db.prepare(
        `INSERT INTO activity (id, kind, state, pet_id, app, tool, access, started_at)
         VALUES ('a1', 'connector', 'done', 'scout', 'Notion', 'search', 'read', 'x')`,
      ).run();

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      expect(db.prepare("SELECT app FROM activity WHERE id = 'a1'").get()).toEqual({
        app: 'Notion',
      });
      db.prepare(
        `INSERT INTO activity (id, kind, state, pet_id, routine_id, text, started_at)
         VALUES ('a2', 'routine', 'running', 'scout', 'r1', 'Morning papers', 'y')`,
      ).run();
      expect(db.prepare("SELECT routine_id FROM activity WHERE id = 'a2'").get()).toEqual({
        routine_id: 'r1',
      });
    } finally {
      db.close();
    }
  });

  it('drops the crew-era roles notice in migration 14', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      db.prepare('DELETE FROM schema_version WHERE version >= 14').run();
      db.exec(`CREATE TABLE notices (id TEXT PRIMARY KEY, json TEXT NOT NULL,
        created_at TEXT NOT NULL, dismissed_at TEXT)`);
      db.prepare("INSERT INTO notices VALUES ('roles-upgrade', '{}', 'x', NULL)").run();

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      expect(tableNames(db)).not.toContain('notices');
    } finally {
      db.close();
    }
  });

  it('adds the log of what Scout saw in migration 15, and rerunning it changes nothing', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(15);
      expect(tableNames(db)).toContain('sight_log');
      db.prepare("INSERT INTO sight_log (id, kind, at) VALUES ('r1', 'screenshot', 'x')").run();

      // Rolled back past 15, as a database restored from before it would be.
      db.prepare('DELETE FROM schema_version WHERE version >= 15').run();
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      const rows = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM sight_log').get();
      expect(rows?.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('adds the one pick-up row in migration 16, and rerunning it keeps the row', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
      expect(tableNames(db)).toContain('pick_up');
      db.prepare(
        "INSERT INTO pick_up (id, started_at, taken_at, json) VALUES (1, 'a', 'b', '{}')",
      ).run();
      // One row only: the snapshot is overwritten, never added to.
      expect(() =>
        db
          .prepare(
            "INSERT INTO pick_up (id, started_at, taken_at, json) VALUES (2, 'a', 'b', '{}')",
          )
          .run(),
      ).toThrow();

      db.prepare('DELETE FROM schema_version WHERE version >= 16').run();
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      const rows = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM pick_up').get();
      expect(rows?.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('adds the usage table in migration 17: counts only, no column for anything said', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
      const columns = db
        .prepare<[], { name: string }>('PRAGMA table_info(usage)')
        .all()
        .map((c) => c.name);
      expect(columns).toEqual([
        'id',
        'at',
        'source',
        'provider_id',
        'model',
        'input_tokens',
        'output_tokens',
        'cost_usd',
      ]);
      // Only Scout or an expert spends.
      expect(() =>
        db
          .prepare(
            `INSERT INTO usage (at, source, provider_id, model, input_tokens, output_tokens)
             VALUES ('a', 'someone', 'p', 'm', 1, 1)`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('indexes what Scout saw and the activity text in migration 18, backfilling old rows', () => {
    const db = new Database(':memory:');
    const count = (sql: string) => db.prepare<[], { n: number }>(sql).get()?.n;
    try {
      migrate(db);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
      // A database from before 18: no index yet, rows already on disk.
      db.exec(`DROP TABLE sight_log_fts; DROP TABLE activity_fts;
        DROP TRIGGER sight_log_ai; DROP TRIGGER sight_log_ad; DROP TRIGGER sight_log_au;
        DROP TRIGGER activity_ai; DROP TRIGGER activity_ad; DROP TRIGGER activity_au;`);
      db.prepare('DELETE FROM schema_version WHERE version >= 18').run();
      db.prepare(
        `INSERT INTO sight_log (id, kind, at, app, title)
         VALUES ('s1', 'read_text', 'x', 'chrome.exe', 'Vector databases explained')`,
      ).run();
      db.prepare(
        `INSERT INTO activity (id, kind, state, pet_id, text, started_at)
         VALUES ('a1', 'turn', 'done', 'scout', 'compare pinecone and qdrant', 'x'),
                ('a2', 'expert', 'done', 'scout', 'Fix login' || char(10, 10) || 'Selected text:' ||
                  char(10) || 'salary figures', 'x')`,
      ).run();

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      // The backfill indexes a brief's ask only, never the selection it carried.
      expect(count("SELECT COUNT(*) AS n FROM activity_fts WHERE activity_fts MATCH 'login'")).toBe(
        1,
      );
      expect(
        count("SELECT COUNT(*) AS n FROM activity_fts WHERE activity_fts MATCH 'salary'"),
      ).toBe(0);

      expect(
        count("SELECT COUNT(*) AS n FROM sight_log_fts WHERE sight_log_fts MATCH 'vector'"),
      ).toBe(1);
      expect(
        count("SELECT COUNT(*) AS n FROM sight_log_fts WHERE sight_log_fts MATCH 'chrome'"),
      ).toBe(1);
      expect(
        count("SELECT COUNT(*) AS n FROM activity_fts WHERE activity_fts MATCH 'qdrant'"),
      ).toBe(1);

      // Rerunning it, as a database rolled back past it would, leaves one entry per row.
      db.prepare('DELETE FROM schema_version WHERE version >= 18').run();
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(
        count("SELECT COUNT(*) AS n FROM sight_log_fts WHERE sight_log_fts MATCH 'vector'"),
      ).toBe(1);
      expect(
        count("SELECT COUNT(*) AS n FROM activity_fts WHERE activity_fts MATCH 'qdrant'"),
      ).toBe(1);
      expect(count('SELECT COUNT(*) AS n FROM activity_fts_docsize')).toBe(2);
      db.exec("INSERT INTO sight_log_fts (sight_log_fts) VALUES ('integrity-check')");
      db.exec("INSERT INTO activity_fts (activity_fts) VALUES ('integrity-check')");
    } finally {
      db.close();
    }
  });

  it('survives reopening the same file', () => {
    openDatabase(dataDir).close();
    const db = openDatabase(dataDir);
    try {
      const applied = db
        .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_version')
        .get();
      expect(applied?.n).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});
