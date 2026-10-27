# Brain memory (row 6): design

Status: draft for review, 2026-10-26.

## Intent

Scout should feel like a Jarvis: it knows who you are, how you want things done, what you are
working on and what you have talked about, and it keeps that across restarts. Today the Python
brain remembers nothing: history is an in-memory list (`brain/src/brain/sessions.py`) and a brain
restart starts a fresh conversation.

This row builds the memory framework, not every kind of memory. New kinds get added later by
adding one entry to a rules table.

## Goals

- One local store, `~/.tagalong/tagalong.db` (under `TAGALONG_HOME`), SQLite with FTS5 search.
- Memory items tagged with a kind; each kind's behaviour comes from one rules table.
- The model decides what to save, through tools. Code writes memory in one place only:
  conversation summaries.
- Instructions the user gives ("this is how it works") are always saved and always loaded.
- Tracking requests ("keep an eye on X") are saved in a shape a later scheduler can read.
- Chat history saved on disk, searchable, and the conversation resumes after a brain restart.

## Non-goals (this row)

- Running scheduled checks for tracking items (a later row reads them).
- Viewing or editing memory from Home (a later body row; the brain stays ready for it).
- A daily tidy pass that merges and drops stale items. `remember` with `replaces` covers updates for now.
- Embeddings or vector search. FTS5 only.
- Migrating any data from the old TypeScript brain (fresh database, per docs/principles.md).
- Multiple users, pets or scopes.

## Anti-goals

- Hoarding: saving things the user did not mean to keep, such as screen content.
- Stating a stale fact with confidence. Updates replace; they do not pile up.
- Slowing every turn down by stuffing all memory into the prompt.
- Code picking facts out of user text by pattern matching (the model decides, see memory
  `model-decides-not-scripts`).

## Kinds

One rules table in `memory.py`, one entry per kind:

| Kind          | Written by | Used                 | Max items | Max chars each |
| ------------- | ---------- | -------------------- | --------- | -------------- |
| `instruction` | model      | always in the prompt | 50        | 300            |
| `about_you`   | model      | always in the prompt | 50        | 300            |
| `tracking`    | model      | always in the prompt | 30        | 300            |
| `project`     | model      | search only          | 200       | 500            |
| `summary`     | code       | search only          | no cap    | no cap         |

The numbers are the builder's starting values; they live only in this table.

- A `tracking` item also carries an optional `cadence`, free text the model chooses ("daily",
  "every Monday", "every 2 hours"). It is stored as a column and not parsed in this row.
- When a kind is full, `remember` returns an error telling the model to `replaces` or `forget`
  something. The model decides what goes; code never evicts silently.
- Always-loaded kinds together are capped (about 2,000 tokens) by the item limits above.

## Tools (the brain's first model tools)

The brain has no tools today: `Session.say` passes `tools=[]` and `_no_tools`. This row adds a
minimal brain-tool list and a `run_tool` that dispatches on name. Keep it small; row 7 extends the
same dispatch with body tools.

- `remember(kind, text, cadence?, replaces?)`: saves an item. `replaces` is an item id; the old
  item is replaced in one transaction. Exact duplicates (same kind, same text) are not added twice.
  Code-only kinds (`summary`) are refused.
- `replaces` rules: same kind only; an unknown id, another kind's id or a `summary` id is an
  error the model sees. A replace never counts against the kind's cap, so a full kind can still be
  updated.
- `recall(query, kind?)`: FTS search over memory items and saved chat. Returns up to about 10 hits
  with id, kind, date and text, within a size cap. Queries are sanitised so they never fail to parse.
- `forget(id)`: deletes one item and returns what was deleted.

soul.md gets a short memory section: always save instructions and tracking requests, save durable
facts about the user, update instead of adding a near-duplicate, recall before saying you don't know.

## Prompt

- Always-loaded kinds are rendered into the system prompt as a "What you know" section, grouped by
  kind, after the soul and before the "Now:" line.
- The section is read once at the start of each turn and kept for every step of that turn, so the
  prompt stays stable within a turn. A `remember` mid-turn shows up from the next turn; its tool
  result already tells the model it was saved.
- Search-only memory reaches the model only through `recall`. There is no automatic search injected
  per message in this row (the model decides when to look).
- Text the user did not write (summaries, saved chat in `recall` results) is fenced and labelled as
  data, not instructions.

## Saved chat and resume

- Messages are written to a `messages` table when a turn ends (in the session's turn-done
  callback): every message the turn added to `Session.history`, the user's say included. Each row has
  time, role, the content as JSON (raw blocks, compaction blocks included) and a plain-text column
  for FTS. Image parts are not stored; they become a `[screenshot]` marker. `run_turn` and its tests
  stay as they are. A crash mid-turn loses that one turn, which is accepted.
- On brain start, the session rebuilds history from the saved messages: start at the assistant
  message holding the latest compaction block if there is one, then take at most the last 50
  messages, trimmed from the front to whole turns so the history stays valid for the API (every
  `tool_use` keeps its `tool_result`, and the history starts on a user message).
- Summaries: the brain already runs with server-side compaction (`turn.py`). When a response
  carries a compaction block, its text is also saved as a `summary` item so `recall` can find it.
  Resume replays the stored block as is. The builder confirms first, against the API docs
  (claude-api skill), that a compaction block can be sent back in a later request. If it can't,
  resume puts the summary text in as a fenced user message instead.
- A fallback summariser (our own model call when compaction never fires) is out of this row; it
  becomes a follow-up if compaction proves unreliable.

## Storage

- `memory.py` owns the database: open with WAL, numbered migrations tracked by `PRAGMA user_version`,
  never edited once shipped.
- Tables: `memories(id, kind, text, cadence, created_at, updated_at)` with an external-content
  FTS5 table kept in sync by triggers; `messages(id, at, role, content_json, text)` with its own FTS5
  table. Tokenizer `porter unicode61`.
- stdlib `sqlite3`, no new dependency. Calls are fast enough to run inline; the builder may move
  them to a thread if a test shows blocking.
- The brain checks FTS5 is available when it opens the database and fails at start with a clear
  message if not. No plain-match fallback.

## Constraints

- Python brain only. No change to the contract (protocol/README.md) or the bodies.
- TDD with pytest against a temp database; the model stays faked.
- Docs updated in the same PR: docs/brain.md (remove row 6 from "Not built yet"), docs/memory.md
  (describe the Python brain's memory; the old core section is marked as the old brain),
  docs/testing/feature-test-guide.md, README.md if user-facing, and CLAUDE.md's layout line for
  brain/.
- Two PRs: 6a (store, kinds, tools, prompt, soul section) and 6b (saved chat, resume, compaction
  summaries). Each stays within 500-1,000 changed lines.

## Left to the builder

- Exact SQL, ids (uuid hex or integer), and the rendering format of the "What you know" section.
- Tool descriptions' wording, within the soul rules above.
- How many hits `recall` returns and the size cap, within "about 10".
