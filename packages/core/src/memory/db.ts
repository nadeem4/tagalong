import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/** The SQLite file a host finds in its data dir. */
export const DB_FILENAME = 'tagalong.db';

/**
 * Numbered migrations, applied in order and never edited once shipped: an installed
 * database has already run them, so a change here would only ever reach fresh installs.
 * Add a new entry instead.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE pets (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE conversations (id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL);
   CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, snapshot_json TEXT, created_at TEXT NOT NULL);
   CREATE INDEX messages_conv ON messages(conversation_id, created_at);`,
  // Phase 4. Which default pets were ever seeded, so deleting one keeps it deleted while
  // an install that predates the crew still gains the new members. Pets already present
  // count as seeded: they came from an earlier seed or from the user.
  `CREATE TABLE pet_seeds (id TEXT PRIMARY KEY, seeded_at TEXT NOT NULL);
   INSERT INTO pet_seeds (id, seeded_at) SELECT id, updated_at FROM pets;`,
  // Phase 4. Memories: private to one pet (`scope = 'pet'`) or shared by the crew
  // (`scope = 'crew'`), searched through an external-content FTS5 index kept in step by
  // triggers. Porter stemming so "answers" finds "answer".
  `CREATE TABLE memories (
     id TEXT PRIMARY KEY,
     scope TEXT NOT NULL CHECK (scope IN ('pet', 'crew')),
     pet_id TEXT,
     kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'summary')),
     text TEXT NOT NULL,
     created_at TEXT NOT NULL,
     CHECK ((scope = 'pet') = (pet_id IS NOT NULL))
   );
   CREATE INDEX memories_pet ON memories(pet_id, created_at);
   CREATE VIRTUAL TABLE memories_fts USING fts5(
     text, content = 'memories', content_rowid = 'rowid', tokenize = 'porter unicode61'
   );
   CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
     INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
   END;
   CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
     INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
   END;
   CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
     INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
     INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
   END;`,
  // Phase 4. Set when a background summary has folded a message into a summary memory, so
  // the history replayed to the model stays short while the full thread stays on disk.
  `ALTER TABLE messages ADD COLUMN summarized_at TEXT;`,
];

/** Version a fully migrated database reports. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Brings a database up to the latest schema and returns the version it now sits at.
 * Applied versions are recorded row by row, so rerunning this is a no-op.
 */
export function migrate(db: Database.Database): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const current =
    db
      .prepare<[], { version: number | null }>('SELECT MAX(version) AS version FROM schema_version')
      .get()?.version ?? 0;

  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');
  for (let version = current + 1; version <= MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version - 1];
    if (sql === undefined) continue;
    // One transaction per migration so a failure leaves the previous version intact.
    db.transaction(() => {
      db.exec(sql);
      record.run(version, new Date().toISOString());
    })();
  }

  return LATEST_SCHEMA_VERSION;
}

/** Opens (creating if needed) the migrated database for a host's data dir. */
export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, DB_FILENAME));
  // Foreign keys are off by default in SQLite, and WAL keeps reads from blocking writes.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
