/** Tests for openDatabase and every migration, including upgrades of older databases. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Pet } from '@tagalong/protocol';
import { UsageLog } from '../usage/usage-log';
import { DB_FILENAME, LATEST_SCHEMA_VERSION, migrate, openDatabase } from './db';
import { MemoryStore } from './memories';
import { PetRegistry } from '../pets/registry';

/** Migration 20, which keeps only Scout. */
const ONE_COMPANION = 20;

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
        'episode_events',
        'episodes',
        'expert_routes',
        'experts',
        'jobs',
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
        'sqlite_sequence',
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

      expect(migrate(db, 5)).toBe(5);

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

      expect(migrate(db, 11)).toBe(11);

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

  it('moves every pet off the retired nebius provider in migration 19', () => {
    const db = new Database(':memory:');
    const petJson = (id: string) =>
      db.prepare<[string], { json: string }>('SELECT json FROM pets WHERE id = ?').get(id)?.json;
    try {
      migrate(db);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(20);
      // A database from before 19: a pet still thinking on Nebius, one on OpenRouter.
      db.prepare('DELETE FROM schema_version WHERE version >= 19').run();
      const insert = db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)');
      insert.run(
        'scout',
        JSON.stringify({
          id: 'scout',
          name: 'Scout',
          avatar: 'fox',
          roleId: 'companion',
          notes: 'keep me',
          providerId: 'nebius',
          model: 'nvidia/nemotron-3-super-120b-a12b',
          visionModel: 'nvidia/Nemotron-Nano-V2-12b',
          watchModel: 'nvidia/nemotron-3-nano-30b-a3b',
          toolGrants: { notify: 'allowed' },
        }),
        'old',
      );
      const other = JSON.stringify({
        id: 'sage',
        name: 'Sage',
        avatar: 'owl',
        roleId: 'companion',
        providerId: 'openrouter',
        model: 'anthropic/claude-haiku-4.5',
        visionModel: 'some/vision-model',
      });
      insert.run('sage', other, 'old');
      db.prepare(
        `INSERT INTO usage (at, source, provider_id, model, input_tokens, output_tokens)
         VALUES ('2026-10-01T00:00:00.000Z', 'scout', 'nebius', 'nvidia/x', 10, 5)`,
      ).run();

      expect(migrate(db, 19)).toBe(19);

      const moved = JSON.parse(petJson('scout') ?? '{}') as Record<string, unknown>;
      expect(moved).toMatchObject({
        providerId: 'claude-code',
        model: 'haiku',
        notes: 'keep me',
        roleId: 'companion',
        toolGrants: { notify: 'allowed' },
      });
      expect(moved).not.toHaveProperty('visionModel');
      expect(moved).not.toHaveProperty('watchModel');
      expect(Pet.safeParse(moved).success).toBe(true);
      const stamp = db
        .prepare<[], { updated_at: string }>("SELECT updated_at FROM pets WHERE id = 'scout'")
        .get()?.updated_at;
      expect(stamp).not.toBe('old');
      // Any other pet is left exactly as it was.
      expect(petJson('sage')).toBe(other);
      // History stays: the old usage row is still there.
      expect(
        db
          .prepare<[], { n: number }>(
            "SELECT COUNT(*) AS n FROM usage WHERE provider_id = 'nebius'",
          )
          .get()?.n,
      ).toBe(1);
      // And the Spend card still sums it, under its old provider id.
      const usage = new UsageLog(db, {
        now: () => Date.parse('2026-10-01T12:00:00.000Z'),
        timeZone: () => 'UTC',
      });
      expect(usage.summary().month).toEqual([
        expect.objectContaining({
          source: 'scout',
          providerId: 'nebius',
          inputTokens: 10,
          outputTokens: 5,
        }),
      ]);

      // Rerunning it changes nothing more.
      db.prepare('DELETE FROM schema_version WHERE version >= 19').run();
      expect(migrate(db, 19)).toBe(19);
      expect(JSON.parse(petJson('scout') ?? '{}')).toEqual(moved);
      expect(petJson('sage')).toBe(other);
    } finally {
      db.close();
    }
  });

  it('migrate stops at upTo', () => {
    const db = new Database(':memory:');
    try {
      expect(migrate(db, 3)).toBe(3);
      expect(tableNames(db)).toContain('memories');
      expect(tableNames(db)).not.toContain('activity');
      expect(migrate(db, 2)).toBe(3);
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("keeps only Scout in migration 20, with the crew's memories moved to Scout and the others' data gone", () => {
    const db = new Database(':memory:');
    const ids = (sql: string) =>
      db
        .prepare<[], { id: string }>(sql)
        .all()
        .map((row) => row.id);
    try {
      migrate(db);
      db.prepare('DELETE FROM schema_version WHERE version >= ?').run(ONE_COMPANION);
      const pet = db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)');
      pet.run(
        'scout',
        JSON.stringify({
          id: 'scout',
          name: 'Scout',
          roleId: 'companion',
          toolGrants: { remember: 'off' },
          replyStyle: 'voice-full',
          notes: 'Be terse.',
          color: '#E8873A',
        }),
        'x',
      );
      pet.run('pip', JSON.stringify({ id: 'pip', name: 'Pip' }), 'x');
      db.exec(`INSERT INTO conversations (id, pet_id, created_at)
          VALUES ('c-scout', 'scout', 'x'), ('c-pip', 'pip', 'x');
        INSERT INTO messages (id, conversation_id, role, content_json, created_at)
          VALUES ('m-scout', 'c-scout', 'user', '[]', 'x'), ('m-pip', 'c-pip', 'user', '[]', 'x');
        INSERT INTO memories (id, scope, pet_id, kind, text, created_at)
          VALUES ('mem-scout', 'pet', 'scout', 'fact', 'likes tea', 'x'),
                 ('mem-pip', 'pet', 'pip', 'fact', 'likes coffee', 'x'),
                 ('mem-crew', 'crew', NULL, 'preference', 'prefers marmalade', 'x');
        INSERT INTO activity (id, kind, state, pet_id, text, started_at)
          VALUES ('a-scout', 'turn', 'done', 'scout', 'compare qdrant', 'x'),
                 ('a-pip', 'turn', 'done', 'pip', 'compare pinecone', 'x');`);

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);

      expect(ids('SELECT id FROM pets')).toEqual(['scout']);
      const scout = JSON.parse(
        db.prepare<[], { json: string }>("SELECT json FROM pets WHERE id = 'scout'").get()?.json ??
          '{}',
      ) as Record<string, unknown>;
      for (const key of ['toolGrants', 'replyStyle', 'notes', 'color']) {
        expect(scout).not.toHaveProperty(key);
      }
      expect(scout).toMatchObject({ name: 'Scout', roleId: 'companion' });
      expect(ids('SELECT id FROM conversations')).toEqual(['c-scout']);
      expect(ids('SELECT id FROM messages')).toEqual(['m-scout']);
      expect(
        db
          .prepare<[], { id: string; scope: string; pet_id: string }>(
            'SELECT id, scope, pet_id FROM memories ORDER BY id',
          )
          .all(),
      ).toEqual([
        { id: 'mem-crew', scope: 'pet', pet_id: 'scout' },
        { id: 'mem-scout', scope: 'pet', pet_id: 'scout' },
      ]);
      // The moved row is still in the index, so Scout can find it.
      expect(new MemoryStore(db).search('scout', 'marmalade', 5).map((m) => m.id)).toEqual([
        'mem-crew',
      ]);
      expect(ids('SELECT id FROM activity')).toEqual(['a-scout']);
      expect(
        db
          .prepare<[], { n: number }>(
            "SELECT COUNT(*) AS n FROM activity_fts WHERE activity_fts MATCH 'pinecone'",
          )
          .get()?.n,
      ).toBe(0);
      db.exec("INSERT INTO memories_fts (memories_fts) VALUES ('integrity-check')");
      db.exec("INSERT INTO activity_fts (activity_fts) VALUES ('integrity-check')");

      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(ids('SELECT id FROM pets')).toEqual(['scout']);
    } finally {
      db.close();
    }
  });

  it('does not give Scout the same memory twice when a crew row repeats one of its own', () => {
    const db = new Database(':memory:');
    try {
      migrate(db, ONE_COMPANION - 1);
      db.exec(`INSERT INTO memories (id, scope, pet_id, kind, text, created_at)
          VALUES ('mem-scout', 'pet', 'scout', 'preference', 'prefers short answers', 'x'),
                 ('mem-crew', 'crew', NULL, 'preference', 'prefers short answers', 'x'),
                 ('mem-other', 'crew', NULL, 'fact', 'uses pnpm', 'x');`);

      migrate(db);

      expect(
        db
          .prepare<[], { id: string }>('SELECT id FROM memories ORDER BY id')
          .all()
          .map((row) => row.id),
      ).toEqual(['mem-other', 'mem-scout']);
      db.exec("INSERT INTO memories_fts (memories_fts) VALUES ('integrity-check')");
    } finally {
      db.close();
    }
  });

  it('brings Scout back on the same boot when migration 20 finds only another pet', () => {
    const db = new Database(':memory:');
    try {
      migrate(db, ONE_COMPANION - 1);
      db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
        'pip',
        JSON.stringify({ id: 'pip', name: 'Pip' }),
        'x',
      );
      db.prepare("INSERT OR IGNORE INTO pet_seeds (id, seeded_at) VALUES ('scout', 'x')").run();

      migrate(db);
      new PetRegistry(db).seedDefaults();

      expect(new PetRegistry(db).list().map((p) => p.id)).toEqual(['scout']);
    } finally {
      db.close();
    }
  });

  it('creates the jobs table in migration 21, idempotently, with its kinds and states checked', () => {
    const db = new Database(':memory:');
    try {
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(21);
      migrate(db);
      const insert = db.prepare(
        `INSERT INTO jobs (id, kind, state, pet_id, task, dedupe_key, created_at)
         VALUES (?, ?, ?, 'scout', 'read it', 'read it', 'x')`,
      );
      insert.run('j1', 'job', 'queued');
      insert.run('j2', 'digest', 'done');
      expect(() => insert.run('j3', 'other', 'queued')).toThrow();
      expect(() => insert.run('j4', 'job', 'waiting')).toThrow();
      // Rerunning 21 on its own keeps the rows.
      db.prepare('DELETE FROM schema_version WHERE version >= 21').run();
      expect(migrate(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  });

  it('gives memories an origin in migration 22: existing rows are the user’s, others refused', () => {
    const db = new Database(':memory:');
    try {
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(22);
      migrate(db, 21);
      db.prepare(
        `INSERT INTO memories (id, scope, pet_id, kind, text, created_at)
         VALUES ('m1', 'pet', 'scout', 'fact', 'They live in Leeds', 'x')`,
      ).run();
      expect(migrate(db, 22)).toBe(22);
      expect(db.prepare('SELECT origin FROM memories WHERE id = ?').get('m1')).toEqual({
        origin: 'user',
      });
      const insert = db.prepare(
        `INSERT INTO memories (id, scope, pet_id, kind, text, created_at, origin)
         VALUES (?, 'pet', 'scout', 'fact', 'x', 'x', ?)`,
      );
      insert.run('m2', 'digest');
      expect(() => insert.run('m3', 'web')).toThrow();
      // Rerunning 22 on its own keeps the rows and their origins.
      db.prepare('DELETE FROM schema_version WHERE version >= 22').run();
      expect(migrate(db, 22)).toBe(22);
      expect(db.prepare('SELECT origin FROM memories WHERE id = ?').get('m2')).toEqual({
        origin: 'digest',
      });
    } finally {
      db.close();
    }
  });

  it('adds the experience log in migration 23: episodes, and events that go with them', () => {
    const db = new Database(':memory:');
    try {
      expect(LATEST_SCHEMA_VERSION).toBe(23);
      migrate(db);
      db.pragma('foreign_keys = ON');
      db.prepare(
        `INSERT INTO episodes (id, mode, trigger, pet_id, started_at)
         VALUES ('e1', 'turn', 'asked', 'scout', 'x')`,
      ).run();
      const event = db.prepare(
        `INSERT INTO episode_events (episode_id, kind, name, at) VALUES ('e1', ?, 'x', 'x')`,
      );
      event.run('step');
      expect(() => event.run('dream')).toThrow();
      db.prepare("DELETE FROM episodes WHERE id = 'e1'").run();
      expect(db.prepare('SELECT COUNT(*) AS n FROM episode_events').get()).toEqual({ n: 0 });
      // Rerunning 23 on its own is harmless.
      db.prepare('DELETE FROM schema_version WHERE version >= 23').run();
      expect(migrate(db)).toBe(23);
      const columns = () =>
        db
          .prepare<[], { name: string }>('PRAGMA table_info(episode_events)')
          .all()
          .map((column) => column.name);
      expect(columns()).toContain('call_id');
      // Rerun over an early build's events table, before it kept the call id, 23 adds it.
      db.exec('DROP TABLE episode_events');
      db.exec(
        `CREATE TABLE episode_events (id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL,
           kind TEXT NOT NULL, name TEXT NOT NULL, input TEXT, result TEXT, ok INTEGER, at TEXT NOT NULL)`,
      );
      db.prepare('DELETE FROM schema_version WHERE version >= 23').run();
      expect(migrate(db)).toBe(23);
      expect(columns()).toContain('call_id');
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
