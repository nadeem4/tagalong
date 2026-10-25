# Storage

## Purpose

Everything the engine keeps lives in one SQLite file, `tagalong.db`, in the host's data
directory. This doc covers how the file is opened and migrated, every table and who owns it, and
every job that deletes old rows. Settings and secrets are separate files; see
[settings-and-secrets.md](settings-and-secrets.md).

## Where it lives

| File                                      | What it holds                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/memory/db.ts`          | `DB_FILENAME`, `MIGRATIONS`, `migrate`, `openDatabase`, `LATEST_SCHEMA_VERSION`                |
| `packages/core/src/pets/roles-upgrade.ts` | `upgradePetsToRoles`, migration 5                                                              |
| `packages/core/src/engine.ts`             | `Engine.boot` opens the database, builds every store, runs the boot prunes; `stop()` closes it |
| `bodies/desktop/src/main/index.ts`        | Picks the data directory: `app.getPath('userData')`                                            |

The table owners are listed under [Tables](#tables).

### The data directory

The desktop passes `app.getPath('userData')` as `dataDir`. On Windows that is `%APPDATA%\Tagalong`
(Electron derives it from `productName` in `bodies/desktop/package.json`; changing the name moves
every install's data with no migration). `pnpm start:fresh` (`bodies/desktop/scripts/start-fresh.mjs`)
passes `--user-data-dir=<temp folder>` for a clean run.

| Path in `dataDir`                                   | Written by                                         |
| --------------------------------------------------- | -------------------------------------------------- |
| `tagalong.db`, `tagalong.db-wal`, `tagalong.db-shm` | `openDatabase` (WAL mode)                          |
| `settings.json` (`.tmp`, `.bak`, `.corrupt`)        | `SettingsStore`                                    |
| `secrets.json`                                      | `SafeStorageSecretStore` (desktop)                 |
| `pairing.token`                                     | `readOrCreatePairingToken` (`server/pairing.ts`)   |
| `self/`                                             | `SelfStore`: the current text of Scout's notes     |
| `logs/tagalong.log`                                 | `bodies/desktop/src/main/log-file.ts`              |
| `voice/`                                            | Downloaded voice models (see [voice.md](voice.md)) |

## How it works

### Opening

`openDatabase(dataDir)` creates the directory if needed, opens `join(dataDir, 'tagalong.db')`
with `better-sqlite3` (13.0.3), sets `journal_mode = WAL` (reads never block writes) and
`foreign_keys = ON` (off by default in SQLite; `episode_events` relies on it), runs `migrate(db)`
and returns the handle. The engine opens it once at the start of `Engine.boot` and closes it last
in `Engine.stop()`, after the digest, sleep, watches, hand-offs, jobs, connections, runner and
server have stopped. All access is synchronous on the engine's thread.

### Migrations

`MIGRATIONS` is an ordered array. Each entry is SQL, or a function for a change SQL cannot
express. Entries are never edited once shipped: an installed database has already run them, so an
edit would only reach fresh installs. A change is a new entry.

`migrate(db, upTo = MIGRATIONS.length)`:

1. Creates `schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)` if missing.
2. Reads `MAX(version)` (0 for a new file).
3. Runs each later migration in its own transaction, recording its version in the same
   transaction, so a failure leaves the previous version intact.
4. Returns the version it now sits at. Rerunning is a no-op. Only tests pass `upTo`.

The `CREATE` statements from migration 7 on use `IF NOT EXISTS`, and the function migrations (8, 12, 13, 22, 23) check
`PRAGMA table_info` before altering, so a database rolled back past them (the role tests rewind
to version 4) migrates again cleanly. `LATEST_SCHEMA_VERSION` is `MIGRATIONS.length`, now 25.

SQLite cannot change a `CHECK` constraint, so migrations 8, 12 and 13 rebuild `activity` as
`activity_v8`, `activity_v12` and `activity_v13`, copy every row with its `rowid` (rowid orders
the activity list), drop the old table, rename, and recreate the `activity_turn` and
`activity_run` indexes.

| #   | Kind     | What it does                                                                                                                                                                                                                                                                                                          |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SQL      | Creates `pets`, `conversations`, `messages` and the index `messages_conv (conversation_id, created_at)`                                                                                                                                                                                                               |
| 2   | SQL      | Creates `pet_seeds`; every pet already present counts as seeded                                                                                                                                                                                                                                                       |
| 3   | SQL      | Creates `memories` (`scope` `pet`/`crew`, `kind` `fact`/`preference`/`summary`), index `memories_pet`, external-content FTS5 `memories_fts` (porter unicode61) and triggers `memories_ai`, `memories_ad`, `memories_au`                                                                                               |
| 4   | SQL      | Adds `messages.summarized_at`                                                                                                                                                                                                                                                                                         |
| 5   | Function | `upgradePetsToRoles`: gives every stored pet a role; an edited persona becomes the pet's notes                                                                                                                                                                                                                        |
| 6   | Function | Does nothing; kept so later numbers stay                                                                                                                                                                                                                                                                              |
| 7   | SQL      | Creates `activity` (kinds `turn`, `consult`, `handoff`, `roundtable`) with indexes `activity_turn`, `activity_run`                                                                                                                                                                                                    |
| 8   | Function | `addExperts`: creates `experts`; rebuilds `activity` with kind `expert` and columns `expert_id`, `expert_name`, `changed_files`                                                                                                                                                                                       |
| 9   | SQL      | Creates `expert_routes`. Unused: the model picks the expert                                                                                                                                                                                                                                                           |
| 10  | SQL      | Creates `projects` (path, name, last used) for hand-off project suggestions                                                                                                                                                                                                                                           |
| 11  | SQL      | Deletes the old default pets `ink` and `bolt`; their conversations stay; `pet_seeds` keeps them from returning                                                                                                                                                                                                        |
| 12  | Function | `addConnections`: creates `connections`; rebuilds `activity` with kind `connector` and columns `app`, `tool`, `access`                                                                                                                                                                                                |
| 13  | Function | `addRoutines`: creates `routines`; rebuilds `activity` with kind `routine` and column `routine_id`                                                                                                                                                                                                                    |
| 14  | SQL      | Drops `notices` if present                                                                                                                                                                                                                                                                                            |
| 15  | SQL      | Creates `sight_log` (metadata only, `kind` without a `CHECK`) and index `sight_log_at`                                                                                                                                                                                                                                |
| 16  | SQL      | Creates `pick_up`, one row (`CHECK (id = 1)`)                                                                                                                                                                                                                                                                         |
| 17  | SQL      | Creates `usage` (counts and price only) and index `usage_at`                                                                                                                                                                                                                                                          |
| 18  | SQL      | Creates `sight_log_fts` (external content over `title`, `app`) and `activity_fts` (contentless, `contentless_delete = 1`, the ask only via `activityAsk`), their triggers, and backfills both                                                                                                                         |
| 19  | SQL      | Moves any pet on the removed `nebius` provider to `claude-code` / `haiku` and drops its `visionModel`, `watchModel`. Usage, activity and sight-log rows keep `nebius`                                                                                                                                                 |
| 20  | SQL      | One companion: deletes every pet but `scout` with its conversations, messages, private memories and activity; moves `crew` memories to Scout (skipping duplicates); strips `toolGrants`, `replyStyle`, `notes`, `color` from Scout; drops Scout's seed record if Scout is missing, so it is seeded again on this boot |
| 21  | SQL      | Creates `jobs` (kinds `job`, `digest`) and index `jobs_state (state, created_at)`                                                                                                                                                                                                                                     |
| 22  | Function | `addMemoryOrigin`: adds `memories.origin` (`user`/`digest`, default `user`)                                                                                                                                                                                                                                           |
| 23  | Function | `addExperienceLog`: creates `episodes` (indexes `episodes_ref`, `episodes_started`) and `episode_events` (`ON DELETE CASCADE`, index `episode_events_episode`); adds `episode_events.call_id` if missing                                                                                                              |
| 24  | SQL      | Creates `self_versions` (index `self_versions_path`) and `self_sleeps`                                                                                                                                                                                                                                                |
| 25  | SQL      | Creates `asks` and index `asks_state (state, created_at)`                                                                                                                                                                                                                                                             |

### Tables

Paths are under `packages/core/src`.

| Table            | Key columns                                                                                                                                                                                                                                                                                     | Owner                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `schema_version` | `version` PK, `applied_at`                                                                                                                                                                                                                                                                      | `migrate` (`memory/db.ts`)                      |
| `pets`           | `id` PK, `json` (a validated `Pet`), `updated_at`                                                                                                                                                                                                                                               | `PetRegistry` (`pets/registry.ts`)              |
| `pet_seeds`      | `id` PK, `seeded_at`                                                                                                                                                                                                                                                                            | `PetRegistry.seedDefaults`                      |
| `conversations`  | `id` PK, `pet_id`, `title`, `created_at`                                                                                                                                                                                                                                                        | `ConversationStore` (`memory/store.ts`)         |
| `messages`       | `id` PK, `conversation_id`, `role`, `content_json`, `snapshot_json`, `created_at`, `summarized_at`                                                                                                                                                                                              | `ConversationStore`; summarised by `Summarizer` |
| `memories`       | `id` PK, `scope` (always `pet`), `pet_id`, `kind`, `text`, `created_at`, `origin`                                                                                                                                                                                                               | `MemoryStore` (`memory/memories.ts`)            |
| `memories_fts`   | FTS5 over `memories.text`                                                                                                                                                                                                                                                                       | Triggers on `memories`                          |
| `activity`       | `id` PK, `kind`, `state`, `pet_id`, `turn_id`, `conversation_id`, `provider_id`, `model`, `text`, `answer`, `error`, `model_calls`, `started_at`, `finished_at`, `expert_id`, `expert_name`, `changed_files`, `app`, `tool`, `access`, `routine_id` (and unused crew-era `to_pet_id`, `run_id`) | `ActivityLog` (`memory/activity.ts`)            |
| `activity_fts`   | Contentless FTS5 of each row's ask                                                                                                                                                                                                                                                              | Triggers on `activity`                          |
| `experts`        | `id` PK, `json`, `updated_at`                                                                                                                                                                                                                                                                   | `ExpertStore` (`experts/store.ts`)              |
| `expert_routes`  | `task_kind` PK, `expert_id`, `chosen_by`, `updated_at`                                                                                                                                                                                                                                          | None (unused)                                   |
| `projects`       | `path` PK, `name`, `last_used`                                                                                                                                                                                                                                                                  | `ProjectMemory` (`projects/finder.ts`)          |
| `connections`    | `id` PK, `json` (definition only, no tokens), `updated_at`                                                                                                                                                                                                                                      | `ConnectionStore` (`connections/store.ts`)      |
| `routines`       | `id` PK, `json`, `last_due_at`, `last_run_at`, `last_state`, `last_activity_id`, `updated_at`                                                                                                                                                                                                   | `RoutineStore` (`routines/store.ts`)            |
| `sight_log`      | `id` PK, `kind`, `at`, `app`, `title`, `provider_id`, `model`, `expert_name`, `windows`, `chars`, `images`, `source`                                                                                                                                                                            | `SightLog` (`memory/sight-log.ts`)              |
| `sight_log_fts`  | FTS5 over `sight_log.title`, `app`                                                                                                                                                                                                                                                              | Triggers on `sight_log`                         |
| `pick_up`        | `id` = 1, `started_at`, `taken_at`, `json` (projects, hand-offs)                                                                                                                                                                                                                                | `PickUpStore` (`pick-up/store.ts`)              |
| `usage`          | `id` PK, `at`, `source` (`scout`/`expert`), `provider_id`, `model`, `input_tokens`, `output_tokens`, `cost_usd`                                                                                                                                                                                 | `UsageLog` (`usage/usage-log.ts`)               |
| `jobs`           | `id` PK, `kind` (`job`/`digest`), `state`, `pet_id`, `task`, `dedupe_key`, `conversation_id`, `note`, `error`, `created_at`, `started_at`, `finished_at`, `reported_at`, `digested_at`                                                                                                          | `JobStore` (`jobs/store.ts`)                    |
| `episodes`       | `id` PK, `mode`, `trigger`, `pet_id`, `ref`, `conversation_id`, `model`, `input`, `decision`, `said`, `note`, token counts, `model_calls`, `started_at`, `ended_at`                                                                                                                             | `ExperienceLog` (`memory/experience.ts`)        |
| `episode_events` | `id` PK, `episode_id` FK, `kind` (`step`/`outcome`), `name`, `call_id`, `input`, `result`, `ok`, `at`                                                                                                                                                                                           | `ExperienceLog`                                 |
| `self_versions`  | `id` PK, `path`, `text`, `author` (`person`/`scout`/`sleep`), `why`, `ref`, `at`, `state` (`applied`/`proposed`/`accepted`/`rejected`), `accepted_by`                                                                                                                                           | `SelfStore` (`self/store.ts`)                   |
| `self_sleeps`    | `id` PK, `state`, `started_at`, `finished_at`, `note`                                                                                                                                                                                                                                           | `Sleep` (`self/sleep.ts`)                       |
| `asks`           | `id` PK, `kind` (`app-change`/`handoff`), `pet_id`, `summary`, `risk`, `app`, `tool`, `expert_id`, `origin_turn_id`, `payload_json`, `state`, `answered_by`, `note`, `created_at`, `expires_at`, `answered_at`                                                                                  | `AskStore` (`asks/store.ts`)                    |

`JobStore` also deletes from `conversations` and `messages` when a job goes. Subsystem detail is
in [memory.md](memory.md), [mind.md](mind.md), [experts.md](experts.md), [asks.md](asks.md),
[routines.md](routines.md), [connected-apps.md](connected-apps.md) and [sight.md](sight.md).

### Validation on the way out

The JSON columns are opaque to SQLite. `ConversationStore` re-parses every conversation and message
through the protocol schemas (`Conversation`, `Message`), and `SightLog.list` drops a row whose
`kind` this version does not know (`SightLogEntry.safeParse`), so an old or hand-edited row is
caught at the store rather than in a model call.

## Retention and prune jobs

| What                                         | Rule                                                                                                        | Age                                                          | When it runs                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `sight_log`                                  | `SightLog.prune`: `at < now - days`                                                                         | `settings.sightLog.days`: 7, range 1 to 30                   | At boot and before every `SightLog.record`                               |
| `activity`                                   | `ActivityLog.prune`: `started_at` older, `state <> 'running'`                                               | `ACTIVITY_KEEP_DAYS` = 90                                    | At boot only                                                             |
| `episodes`, `episode_events`                 | `ExperienceLog.prune`: `started_at` older                                                                   | `EXPERIENCE_KEEP_DAYS` = 30                                  | At boot and on every digest check (5 min after start, then every 30 min) |
| `asks`                                       | `AskStore.prune`: `state <> 'waiting'`, `answered_at` older; waiting rows never go                          | `ASK_KEEP_DAYS` = 30                                         | At boot and on every digest check                                        |
| `jobs` and their `conversations`, `messages` | `JobStore.prune`: not queued or running, `finished_at` older (both kinds, so digest rows too)               | `KEEP_DAYS` = 14 (`jobs/jobs.ts`)                            | At boot and after each digest that worked                                |
| `memories` of kind `summary`                 | `MemoryStore.evictSummaries`: oldest beyond the cap                                                         | Count, `SUMMARY_CAP` = 200                                   | After each digest that worked                                            |
| `messages.snapshot_json` pixels              | `ConversationStore.purgeExpiredScreenshots`: strips the image, keeps the rest of the snapshot               | `settings.screenshotRetention`: `off` (all) or 1 to 24 hours | At the start of every turn                                               |
| `pick_up`                                    | Overwritten every 10 minutes (`SNAPSHOT_EVERY_MS`), reset when taken, deleted when `pickUp` is switched off | One row                                                      | `PickUp` timer; `settings.set`                                           |

Kept until deleted by the person or never pruned: chat `conversations` and `messages` (summarised,
not deleted), `memories` other than evicted summaries, `usage`, `self_versions`, `self_sleeps`,
`pets`, `pet_seeds`, `experts`, `projects`, `connections`, `routines`, `expert_routes`.

The FTS indexes follow their tables through triggers, so a pruned or deleted row leaves search at
once.

### Deleting by hand

| Action                                    | RPC                                                       | Deletes                                               |
| ----------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Home, What Scout remembers, Delete        | `memory.delete`                                           | One memory                                            |
| `forget { id }`                           | (tool)                                                    | One memory, or one finished job with its conversation |
| Home, What Scout saw, Delete / Delete all | `sightLog.delete`, `sightLog.clear`                       | One row, or every `sight_log` row                     |
| Home, How Scout decided, Delete all       | `experience.clear`                                        | Every episode and event, and every answered ask       |
| Settings, Pick up off                     | `settings.set`                                            | The `pick_up` row                                     |
| Remove an expert, connection, routine     | `experts.delete`, `connections.remove`, `routines.delete` | That row                                              |

## Backups and reset

There is no backup, export or reset of `tagalong.db`. To start over, quit and delete the data
directory (or run with another `--user-data-dir`). `settings.json` alone keeps a `.bak` (see
[settings-and-secrets.md](settings-and-secrets.md)).

## Failure handling

- A migration that throws rolls back its own transaction; earlier versions stay applied. The error
  leaves `openDatabase`, so `Engine.boot` fails. The desktop logs
  `[main] the engine did not start:` and keeps running in its degraded mode (Settings from the file;
  see [desktop.md](desktop.md)). The next launch retries from the last recorded version.
- At boot, rows a crash or quit left running are closed: `ActivityLog.interrupted` (`Interrupted:
Tagalong closed before this finished.`), `ExperienceLog.interrupted` (decision `stopped`),
  `RoutineStore.interrupted`, `JobStore.interrupted` (state `error`), and `Asks.boot` (a waiting
  app change expires; a hand-off card waits on).
- A write to the experience log that throws is logged (`[engine] the experience log did not take an
entry:`) and never fails the turn.
- The digest swallows an error write after the database closed at shutdown.

## Privacy notes

`tagalong.db` is local and unencrypted; it relies on the user profile's file permissions. API keys
and tokens are never in it: they are in `secrets.json` (see
[settings-and-secrets.md](settings-and-secrets.md)). `sight_log` and `usage` have no column for
text, pixels or a brief by design. What each table holds, for the person, is in
[privacy.md](privacy.md).

## Tests that pin it

| Test file                                         | Pins                                                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/memory/db.test.ts`             | File created in the data dir, a fresh database at the latest version with every table, rerun is a no-op, `upTo`, reopening, and each migration that changes data (5, 11, 13, 14 to 25) |
| `packages/core/src/memory/store.test.ts`          | Message round-trips and order, last N messages, screenshot purge (inside the window, past it, retention off, dropped images)                                                           |
| `packages/core/src/memory/activity.test.ts`       | Interrupted rows at boot; the 90-day prune, which search follows                                                                                                                       |
| `packages/core/src/memory/sight-log.test.ts`      | Delete, clear, prune on insert and on demand, only the app kept for a blind spot                                                                                                       |
| `packages/core/src/memory/experience.test.ts`     | Delete all, the 30-day prune with its events                                                                                                                                           |
| `packages/core/src/memory/history-search.test.ts` | Indexes follow deletes and prunes                                                                                                                                                      |
| `packages/core/src/memory/digest.test.ts`         | Job prune and the 200-summary cap after a digest                                                                                                                                       |
