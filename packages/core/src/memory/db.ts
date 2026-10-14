import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { recordRolesNotice } from '../pets/roles-notice';
import { upgradePetsToRoles } from '../pets/roles-upgrade';

/** The SQLite file a host finds in its data dir. */
export const DB_FILENAME = 'tagalong.db';

/** SQL, or a function for a change SQL cannot express, such as rewriting pet JSON. */
type Migration = string | ((db: Database.Database) => void);

/**
 * Numbered migrations, applied in order and never edited once shipped: an installed
 * database has already run them, so a change here would only ever reach fresh installs.
 * Add a new entry instead.
 */
const MIGRATIONS: readonly Migration[] = [
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
  // Phase 8. Every stored pet gets a role; an edited persona becomes the pet's notes.
  upgradePetsToRoles,
  // Phase 8. Records what migration 5 did, for the one-time "Your crew has roles now" notice.
  recordRolesNotice,
  // Home. What the crew did — turns, consults, handoffs, roundtables — for the activity
  // view. Written by ActivityLog; rowid orders the rows, newest last. IF NOT EXISTS so a
  // database rolled back past it (the roles tests rewind to version 4) migrates again.
  `CREATE TABLE IF NOT EXISTS activity (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('turn', 'consult', 'handoff', 'roundtable')),
     state TEXT NOT NULL CHECK (state IN ('running', 'done', 'error', 'stopped')),
     pet_id TEXT NOT NULL,
     to_pet_id TEXT,
     turn_id TEXT,
     conversation_id TEXT,
     run_id TEXT,
     provider_id TEXT,
     model TEXT,
     text TEXT,
     answer TEXT,
     error TEXT,
     model_calls INTEGER,
     started_at TEXT NOT NULL,
     finished_at TEXT
   );
   CREATE INDEX IF NOT EXISTS activity_turn ON activity(turn_id);
   CREATE INDEX IF NOT EXISTS activity_run ON activity(run_id);`,
  addExperts,
  // Which expert takes which kind of task: the companion's picks and the user's, the
  // user's always winning. Written by RouteMemory.
  `CREATE TABLE IF NOT EXISTS expert_routes (
     task_kind TEXT PRIMARY KEY,
     expert_id TEXT NOT NULL,
     chosen_by TEXT NOT NULL CHECK (chosen_by IN ('companion', 'user')),
     updated_at TEXT NOT NULL
   )`,
  // The projects the person confirmed for hand-offs, so the next suggestion starts there.
  // Written by ProjectMemory; paths and names only.
  `CREATE TABLE IF NOT EXISTS projects (
     path TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     last_used TEXT NOT NULL
   )`,
  // One companion. Ink and Bolt came from the crew design and are gone; their conversations
  // stay on disk. pet_seeds still lists them, so they are never seeded again.
  `DELETE FROM pets WHERE id IN ('ink', 'bolt')`,
  addConnections,
  addRoutines,
];

/** The columns migration 7 gave `activity`, in order. */
const ACTIVITY_V7_COLUMNS = `id, kind, state, pet_id, to_pet_id, turn_id, conversation_id, run_id,
  provider_id, model, text, answer, error, model_calls, started_at, finished_at`;

/**
 * Migration 8. Experts, and hand-offs to them in the activity log. SQLite cannot change a
 * CHECK constraint, so `activity` is rebuilt with `expert` among its kinds and three new
 * columns, keeping every row and its rowid order. Skipped when the columns are already
 * there, so a database rolled back past it migrates again.
 */
function addExperts(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS experts (
     id TEXT PRIMARY KEY,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`);
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(activity)').all();
  if (columns.some((column) => column.name === 'expert_id')) return;
  db.exec(`CREATE TABLE activity_v8 (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('turn', 'consult', 'handoff', 'roundtable', 'expert')),
     state TEXT NOT NULL CHECK (state IN ('running', 'done', 'error', 'stopped')),
     pet_id TEXT NOT NULL,
     to_pet_id TEXT,
     turn_id TEXT,
     conversation_id TEXT,
     run_id TEXT,
     provider_id TEXT,
     model TEXT,
     text TEXT,
     answer TEXT,
     error TEXT,
     model_calls INTEGER,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     expert_id TEXT,
     expert_name TEXT,
     changed_files TEXT
   );
   INSERT INTO activity_v8 (rowid, ${ACTIVITY_V7_COLUMNS})
     SELECT rowid, ${ACTIVITY_V7_COLUMNS} FROM activity ORDER BY rowid;
   DROP TABLE activity;
   ALTER TABLE activity_v8 RENAME TO activity;
   CREATE INDEX activity_turn ON activity(turn_id);
   CREATE INDEX activity_run ON activity(run_id);`);
}

/** The columns migration 8 gave `activity`, in order. */
const ACTIVITY_V8_COLUMNS = `${ACTIVITY_V7_COLUMNS}, expert_id, expert_name, changed_files`;

/**
 * Connections to the person's apps, and calls to them in the activity log. Definitions only
 * in `connections`: tokens stay in the host's secret store. `activity` is rebuilt, as in
 * migration 8, with `connector` among its kinds and the app, tool and access columns.
 */
function addConnections(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS connections (
     id TEXT PRIMARY KEY,
     json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`);
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(activity)').all();
  if (columns.some((column) => column.name === 'app')) return;
  db.exec(`CREATE TABLE activity_v12 (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('turn', 'consult', 'handoff', 'roundtable', 'expert', 'connector')),
     state TEXT NOT NULL CHECK (state IN ('running', 'done', 'error', 'stopped')),
     pet_id TEXT NOT NULL,
     to_pet_id TEXT,
     turn_id TEXT,
     conversation_id TEXT,
     run_id TEXT,
     provider_id TEXT,
     model TEXT,
     text TEXT,
     answer TEXT,
     error TEXT,
     model_calls INTEGER,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     expert_id TEXT,
     expert_name TEXT,
     changed_files TEXT,
     app TEXT,
     tool TEXT,
     access TEXT
   );
   INSERT INTO activity_v12 (rowid, ${ACTIVITY_V8_COLUMNS})
     SELECT rowid, ${ACTIVITY_V8_COLUMNS} FROM activity ORDER BY rowid;
   DROP TABLE activity;
   ALTER TABLE activity_v12 RENAME TO activity;
   CREATE INDEX activity_turn ON activity(turn_id);
   CREATE INDEX activity_run ON activity(run_id);`);
}

/** The columns migration 12 gave `activity`, in order. */
const ACTIVITY_V12_COLUMNS = `${ACTIVITY_V8_COLUMNS}, app, tool, access`;

/**
 * Migration 13. Routines: the definition as JSON, and how its schedule and its last run
 * stand in columns, so a run never rewrites what the person saved. `last_due_at` is the
 * latest schedule slot handled, which is what keeps a missed routine to one run. `activity`
 * is rebuilt, as in migration 8, with `routine` among its kinds and a `routine_id` column.
 */
function addRoutines(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS routines (
     id TEXT PRIMARY KEY,
     json TEXT NOT NULL,
     last_due_at TEXT,
     last_run_at TEXT,
     last_state TEXT,
     last_activity_id TEXT,
     updated_at TEXT NOT NULL
   )`);
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(activity)').all();
  if (columns.some((column) => column.name === 'routine_id')) return;
  db.exec(`CREATE TABLE activity_v13 (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('turn', 'consult', 'handoff', 'roundtable', 'expert', 'connector', 'routine')),
     state TEXT NOT NULL CHECK (state IN ('running', 'done', 'error', 'stopped')),
     pet_id TEXT NOT NULL,
     to_pet_id TEXT,
     turn_id TEXT,
     conversation_id TEXT,
     run_id TEXT,
     provider_id TEXT,
     model TEXT,
     text TEXT,
     answer TEXT,
     error TEXT,
     model_calls INTEGER,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     expert_id TEXT,
     expert_name TEXT,
     changed_files TEXT,
     app TEXT,
     tool TEXT,
     access TEXT,
     routine_id TEXT
   );
   INSERT INTO activity_v13 (rowid, ${ACTIVITY_V12_COLUMNS})
     SELECT rowid, ${ACTIVITY_V12_COLUMNS} FROM activity ORDER BY rowid;
   DROP TABLE activity;
   ALTER TABLE activity_v13 RENAME TO activity;
   CREATE INDEX activity_turn ON activity(turn_id);
   CREATE INDEX activity_run ON activity(run_id);`);
}

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
    const migration = MIGRATIONS[version - 1];
    if (migration === undefined) continue;
    // One transaction per migration so a failure leaves the previous version intact.
    db.transaction(() => {
      if (typeof migration === 'string') db.exec(migration);
      else migration(db);
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
