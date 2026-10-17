/**
 * Opens tagalong.db and migrates it. Contains the numbered migrations, migrate and
 * openDatabase. Migrations are never edited once shipped.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { upgradePetsToRoles } from '../pets/roles-upgrade';

/** The SQLite file a host finds in its data dir. */
export const DB_FILENAME = 'tagalong.db';

/** SQL, or a function for a change SQL cannot express, such as rewriting pet JSON. */
type Migration = string | ((db: Database.Database) => void);

/**
 * The words of an activity row that search may find (migration 18): a turn's question, a
 * routine's name and a brief's ask (its first paragraph), never the window or selected text
 * a brief carried, and nothing for any other kind, such as app calls. `row` is `new.` or ``.
 */
function activityAsk(row: string): string {
  const brief = `instr(${row}text, char(10, 10))`;
  return `CASE
    WHEN ${row}kind = 'expert' AND ${brief} > 0 THEN substr(${row}text, 1, ${brief} - 1)
    WHEN ${row}kind IN ('turn', 'expert', 'routine') THEN ${row}text
  END`;
}

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
  // Migration 2. Which default pets were ever seeded, so a deleted one stays deleted.
  // Pets already present count as seeded.
  `CREATE TABLE pet_seeds (id TEXT PRIMARY KEY, seeded_at TEXT NOT NULL);
   INSERT INTO pet_seeds (id, seeded_at) SELECT id, updated_at FROM pets;`,
  // Migration 3. Memories, private to one pet (`scope = 'pet'`) or shared
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
  // Migration 4. Set when a background summary has folded a message into a summary memory,
  // so the history replayed to the model stays short while the full thread stays on disk.
  `ALTER TABLE messages ADD COLUMN summarized_at TEXT;`,
  // Migration 5. Every stored pet gets a role; an edited persona becomes the pet's notes.
  upgradePetsToRoles,
  // Migration 6. Does nothing; kept so every later migration keeps its number.
  () => undefined,
  // Migration 7. The activity log, written by ActivityLog; rowid orders the rows, newest
  // last. IF NOT EXISTS so a database rolled back past it (the roles tests rewind to
  // version 4) migrates again.
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
  // Migration 9. Which expert took which kind of task. Unused since the model picks the
  // expert itself (PR "facts not scripts"); kept to avoid a migration.
  `CREATE TABLE IF NOT EXISTS expert_routes (
     task_kind TEXT PRIMARY KEY,
     expert_id TEXT NOT NULL,
     chosen_by TEXT NOT NULL CHECK (chosen_by IN ('companion', 'user')),
     updated_at TEXT NOT NULL
   )`,
  // Migration 10. The projects the person confirmed for hand-offs, so the next suggestion
  // starts there. Written by ProjectMemory; paths and names only.
  `CREATE TABLE IF NOT EXISTS projects (
     path TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     last_used TEXT NOT NULL
   )`,
  // Migration 11. Removes the old default pets Ink and Bolt; their conversations stay on
  // disk, and pet_seeds keeps them from being seeded again.
  `DELETE FROM pets WHERE id IN ('ink', 'bolt')`,
  addConnections,
  addRoutines,
  // Migration 14. Drops the notices table older installs have.
  `DROP TABLE IF EXISTS notices`,
  // Migration 15. What Scout saw: one row each time it looked or sent something away.
  // Metadata only, by design: there is no column for text, pixels or a brief. `kind` has no
  // CHECK, so a new kind of looking needs no migration. Written by SightLog.
  `CREATE TABLE IF NOT EXISTS sight_log (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     at TEXT NOT NULL,
     app TEXT,
     title TEXT,
     provider_id TEXT,
     model TEXT,
     expert_name TEXT,
     windows INTEGER,
     chars INTEGER,
     images INTEGER,
     source TEXT
   );
   CREATE INDEX IF NOT EXISTS sight_log_at ON sight_log(at);`,
  // Migration 16. Pick up where you left off: one row, overwritten every ten minutes, holding
  // project names, paths, branches, file names and unsent asks from window titles. Written by
  // PickUpStore; switching the feature off deletes the row.
  `CREATE TABLE IF NOT EXISTS pick_up (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     started_at TEXT NOT NULL,
     taken_at TEXT NOT NULL,
     json TEXT NOT NULL
   )`,
  // Migration 17. The cost meter: counts only, never what was said. Priced once, when
  // written; null for an unknown model or the Claude sign-in.
  `CREATE TABLE IF NOT EXISTS usage (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('scout', 'expert')),
     provider_id TEXT NOT NULL,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     cost_usd REAL
   );
   CREATE INDEX IF NOT EXISTS usage_at ON usage (at);`,
  // Migration 18. Searchable work memory: external-content FTS5 indexes over the window
  // titles (and apps) Scout looked at and the activity text (asks, briefs, routine names),
  // kept in step by triggers like memories_fts, so a deleted or pruned row leaves the index.
  // 'rebuild' backfills the rows already on disk; rerunning it is harmless.
  `CREATE VIRTUAL TABLE IF NOT EXISTS sight_log_fts USING fts5(
     title, app, content = 'sight_log', content_rowid = 'rowid', tokenize = 'porter unicode61'
   );
   CREATE TRIGGER IF NOT EXISTS sight_log_ai AFTER INSERT ON sight_log BEGIN
     INSERT INTO sight_log_fts (rowid, title, app) VALUES (new.rowid, new.title, new.app);
   END;
   CREATE TRIGGER IF NOT EXISTS sight_log_ad AFTER DELETE ON sight_log BEGIN
     INSERT INTO sight_log_fts (sight_log_fts, rowid, title, app)
       VALUES ('delete', old.rowid, old.title, old.app);
   END;
   CREATE TRIGGER IF NOT EXISTS sight_log_au AFTER UPDATE OF title, app ON sight_log BEGIN
     INSERT INTO sight_log_fts (sight_log_fts, rowid, title, app)
       VALUES ('delete', old.rowid, old.title, old.app);
     INSERT INTO sight_log_fts (rowid, title, app) VALUES (new.rowid, new.title, new.app);
   END;
   INSERT INTO sight_log_fts (sight_log_fts) VALUES ('rebuild');
   -- Only the asks are indexed (see activityAsk), so activity_fts is contentless: it holds
   -- the words of the ask, not activity's whole text, and a row leaves it by rowid. The
   -- backfill empties it first, so rerunning it is harmless.
   CREATE VIRTUAL TABLE IF NOT EXISTS activity_fts USING fts5(
     text, content = '', contentless_delete = 1, tokenize = 'porter unicode61'
   );
   CREATE TRIGGER IF NOT EXISTS activity_ai AFTER INSERT ON activity BEGIN
     INSERT INTO activity_fts (rowid, text) VALUES (new.rowid, ${activityAsk('new.')});
   END;
   CREATE TRIGGER IF NOT EXISTS activity_ad AFTER DELETE ON activity BEGIN
     DELETE FROM activity_fts WHERE rowid = old.rowid;
   END;
   CREATE TRIGGER IF NOT EXISTS activity_au AFTER UPDATE OF kind, text ON activity BEGIN
     DELETE FROM activity_fts WHERE rowid = old.rowid;
     INSERT INTO activity_fts (rowid, text) VALUES (new.rowid, ${activityAsk('new.')});
   END;
   DELETE FROM activity_fts;
   INSERT INTO activity_fts (rowid, text) SELECT rowid, ${activityAsk('')} FROM activity;`,
  // Migration 19. Nebius Token Factory was removed: any pet thinking on it moves to the
  // default brain, the Claude sign-in on its fast model (Scout's own), frozen here so a later
  // change to Scout does not rewrite history. Its vision and watch models named Nemotron ids,
  // so they go. Usage, activity and sight-log rows keep their 'nebius' provider id: history.
  `UPDATE pets
     SET json = json_remove(
           json_set(json, '$.providerId', 'claude-code', '$.model', 'haiku'),
           '$.visionModel', '$.watchModel'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE json_extract(json, '$.providerId') = 'nebius'`,
  // Migration 20. One companion: every pet but Scout goes, with
  // its conversations, messages, private memories and activity rows. The crew notebook's
  // shared memories become Scout's own (one Scout already holds is not copied twice), and
  // Scout's stored pet loses the crew-era grants, reply style, notes and colour. If Scout is
  // missing, its seed record goes too, so seedDefaults brings it back on this boot. 'scout'
  // is a frozen literal, like migration 5's constants.
  `DELETE FROM messages
     WHERE conversation_id IN (SELECT id FROM conversations WHERE pet_id <> 'scout');
   DELETE FROM conversations WHERE pet_id <> 'scout';
   DELETE FROM memories WHERE scope = 'pet' AND pet_id <> 'scout';
   DELETE FROM memories
    WHERE scope = 'crew'
      AND text IN (SELECT text FROM memories WHERE scope = 'pet' AND pet_id = 'scout');
   UPDATE memories SET scope = 'pet', pet_id = 'scout' WHERE scope = 'crew';
   DELETE FROM activity WHERE pet_id <> 'scout';
   DELETE FROM pets WHERE id <> 'scout';
   UPDATE pets
      SET json = json_remove(json, '$.toolGrants', '$.replyStyle', '$.notes', '$.color')
    WHERE id = 'scout';
   DELETE FROM pet_seeds
    WHERE id = 'scout' AND NOT EXISTS (SELECT 1 FROM pets WHERE id = 'scout');`,
  // Migration 21. Scout's own background work: one row per job (a background Scout turn in
  // its own conversation) or memory digest. The full result is the conversation's last
  // assistant message; the row keeps the task, a short note and how it ended. Rows and their
  // conversations go 14 days after they finish (JobStore.prune). No column for screen text.
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('job', 'digest')),
     state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'error', 'stopped')),
     pet_id TEXT NOT NULL,
     task TEXT NOT NULL,
     dedupe_key TEXT NOT NULL,
     conversation_id TEXT,
     note TEXT,
     error TEXT,
     created_at TEXT NOT NULL,
     started_at TEXT,
     finished_at TEXT,
     reported_at TEXT,
     digested_at TEXT
   );
   CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, created_at);`,
  addMemoryOrigin,
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

/**
 * Migration 22. Who wrote a memory: the user (said it, or `remember`), or the digest (which
 * reads job results, so web or file text can steer it). Recall fences digest rows as data.
 * Rows the digest wrote before this cannot be told apart and count as the user's. The search
 * triggers index `text` only, so they need no change. Skipped when the column is already
 * there, so a database rolled back past it migrates again.
 */
function addMemoryOrigin(db: Database.Database): void {
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(memories)').all();
  if (columns.some((column) => column.name === 'origin')) return;
  db.exec(
    "ALTER TABLE memories ADD COLUMN origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'digest'))",
  );
}

/** Version a fully migrated database reports. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Brings a database up to version `upTo` (the latest by default) and returns the version it
 * now sits at. Applied versions are recorded row by row, so rerunning this is a no-op. Only
 * tests pass `upTo`, to check an older migration on its own.
 */
export function migrate(db: Database.Database, upTo: number = MIGRATIONS.length): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const current =
    db
      .prepare<[], { version: number | null }>('SELECT MAX(version) AS version FROM schema_version')
      .get()?.version ?? 0;

  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');
  const target = Math.min(upTo, MIGRATIONS.length);
  for (let version = current + 1; version <= target; version += 1) {
    const migration = MIGRATIONS[version - 1];
    if (migration === undefined) continue;
    // One transaction per migration so a failure leaves the previous version intact.
    db.transaction(() => {
      if (typeof migration === 'string') db.exec(migration);
      else migration(db);
      record.run(version, new Date().toISOString());
    })();
  }

  return Math.max(current, target);
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
