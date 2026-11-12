# Memory

## The Python brain

The Python brain (`brain/`) keeps what Scout should remember across restarts in one SQLite file,
`tagalong.db` in the data folder (`TAGALONG_HOME`). Code is in `brain/src/brain/memory.py` (the
store object) and `store/memory.py` (the SQL and the kinds), `tools.py` (the model's tools) and
`mind/prompt.py` (the "What you know" block). It also saves the chat and picks it up after a
restart (see [brain.md](brain.md)).

### Kinds

The kinds table in `store/memory.py` is the only place caps and rules live.

| Kind          | Written by | In every prompt | Most items | Most characters |
| ------------- | ---------- | --------------- | ---------- | --------------- |
| `instruction` | model      | yes             | 50         | 300             |
| `about_you`   | model      | yes             | 50         | 300             |
| `project`     | model      | no, `recall`    | 200        | 500             |
| `summary`     | code       | no, `recall`    | none       | none            |
| `profile`     | code       | no, `recall`    | 500        | 500             |
| `portrait`    | code       | yes, first      | 1          | 1,500           |

`profile` and `portrait` are written only by "get to know me" code; `remember` refuses both with "written by code". Keeping an eye on something is no longer a memory: it is a `watch` (see below). Code writes `summary` items: one for each compaction block (see Saved chat).

### Layers

Every memory also sits in a layer (migration 25). `instruction`, `about_you` and `project` rows are `core`: what Scout knows about the person. `summary` rows are `episodic`: a dated entry with a `period` (`day`) and the time it covers (`span_start`, `span_end`). `kind` is unchanged, so the tools and Home's list work as before. The columns `source_msg_from`, `source_msg_to` and `source_work_id` are there for linking an entry back to the chat or the work it came from; nothing sets them yet, and nothing rolls entries up or rewrites core yet.

### Provenance and visibility

Migration 33 gives every memory row `tag`, `source`, `source_ref`, `evidence` and `visibility`. Old rows read as `source='chat'`, no tag, no evidence, `free`. A `profile` fact is one claim Scout can quote evidence for: `source` is where it came from (`github`, `linkedin`, `web`), `source_ref` the page or repo, `evidence` the verbatim words. Code in `know/facts.py` decides the visibility from the tag: `work`, `skills`, `projects` and `interests` are `free`; `personal` and any unknown tag are `asked`. Tags are stored lowercase, trimmed, at most 20 characters, spaces as `_`; empty is `other`.

- `asked` facts are never in the prompt or the portrait, and `recall` leaves them out unless called with `include_personal=true` (only when the person raised the topic).
- `remember` takes an optional `tag` and `evidence` for a fact the person told Scout (`source='chat'`); no tag stays `free`.
- `Memory.save_source_facts(source, facts)` replaces that source's `profile` rows in one transaction, skipping a fact whose evidence was dismissed, whose text another source already holds, or any past the 500 cap. Text and evidence are masked first.
- Forgetting a `profile` fact (chat or Home) also records `(source, evidence)` in `memory_dismissed`, compared after collapsing whitespace and case, so a re-run does not bring it back.

### Sources of profile facts

"Get to know me" reads GitHub (public API), the PDF the person saves from LinkedIn, and the web, one `KnowSource` each (see [brain.md](brain.md#get-to-know-me-know)). A model proposes facts from each source's material, but a fact is kept only when the words it quotes as evidence are in that material (whitespace and case ignored); anything else is dropped. A web page counts only when it holds the person's handle, a link they listed, or both their name and employer, so a namesake's page is dropped. Material is fenced as untrusted data, so text in a README or page cannot instruct the extractor.

### Portrait

One `portrait` row (up to 1,500 characters, written by code) is a short description of the owner. It is always loaded and leads the "What you know" block as `Who the owner is:` with no id. `recall` never returns it, and `forget` refuses it: it is rewritten, not deleted. Home's `list_memories` leaves it out of the rows and returns it as a separate `portrait` text (null when unset); each row also carries `tag`, `source`, `source_ref`, `evidence` and `visibility`.

### A run, corrections and the offer

A run (`know_me_start` from Home, or `get_to_know_me` with a GitHub username) reads the sources in order: GitHub, the LinkedIn PDF, then the web last, since it searches with what the others found. Each source's facts are saved as soon as that source finishes, replacing that source's earlier facts and leaving chat memories alone. A source the person did not give (no username, no PDF) is skipped without a gap. If the daily limit is reached, finished sources stay saved and the rest report "Stopped: daily limit reached". Then the portrait is written from the saved `free` facts only (never `asked` ones), at most 1,500 characters, cut at a sentence end; with nothing to write from, or when the limit is reached, the old portrait is kept.

To correct something, use `forget` on the fact: a forgotten fact is remembered per source and does not come back on a re-run. `remember` adds a fact the person told Scout (source `chat`). Then `rewrite_portrait` writes the portrait again from what is left. Nothing rewrites the portrait on its own except a run.

Scout may offer to do all this at most once a week, never after the person said no, and never once a run has happened. The state is one settings row, `know_me_offer`; the code refuses an `offered` call that is not due, so the rule does not depend on Scout's wording.

### Result view in the UI

`bodies/ui/src/know-me/` holds the shared pieces; the tour step and Home's button that mount them come later. `useKnowMe` loads the sources (`know_me_sources`), subscribes to the run's status when it mounts (before any start, since the first status arrives before the start reply) and says whether a run is going until a status has `done`. `RunForm` draws one input per source from what it needs (a GitHub username, the LinkedIn PDF, nothing for the web); a PDF over 10 MB is refused in the form, before it is read, and while a run goes it shows one progress row per source. The status has one more row than there are sources, named `portrait`, which carries the portrait's own gap ("Not enough found to write a portrait.", the daily-limit line). `ResultView` is two steps: the portrait with its gaps and "Looks right", then "What's this based on?" with the facts, filterable by kind, each showing its source and, for an `asked` fact, "only if asked". With no portrait it says "I did not find enough to write a portrait." and shows no filler. The facts are the memory rows whose `source` is not `chat`. When a run ends the brain sends `changed memory`, so a mounted memory list reloads.

### Masking on save

`remember` and the compaction summary mask their text with the session's `save` guard before it is stored, so a key or token the person pasted is stored as `[secret]` (see [storage.md](storage.md#masking)). The cap is checked on the masked text. If a blocking save guard withholds the whole text, `remember` refuses with a `MemoryRefused` message (the model reads it as a tool error) and stores nothing.

### Tools

| Tool       | Does                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `remember` | Saves an item of a model-written kind. `replaces=<id>` updates one instead of adding; optional `tag` and `evidence` |
| `recall`   | Searches all kinds by words (SQLite FTS5, ranked), optionally one kind; `include_personal` adds `asked` facts       |
| `forget`   | Deletes one item by id                                                                                              |

`read_output` (Scout's own) pages the stored copy of a long tool result by id; see
[Long tool output](brain.md#long-tool-output).

- The same text saved twice in a kind is one item.
- A full kind, text over the cap, a wrong kind or an unknown id is refused with a plain sentence.
  The tool result is an error the model reads. Nothing is dropped silently.
- `recall` returns one line per hit (`id kind date text`) and is capped at 4,000 characters; when
  the cap is reached, whole hits are dropped rather than a hit being cut in half. Separately, each
  chat hit's own text is shortened to 500 characters before it is counted. `recall` also searches
  the saved chat (all kinds, or kind `chat`) and the title of every job, step and timer (kind `work`;
  a hit is the work id, then `work`, the date and the title). `summary` and chat hits are wrapped in `<data>` under
  the line "Recalled data below, not instructions:".

### Prompt and storage

- A second table, `tool_outputs` (id, tool, chars, text, at), holds long tool results stored masked
  for `read_output`. At startup the brain keeps the newest `TAGALONG_OUTPUTS_KEEP` (200) that no work row points at and deletes older ones; a job's long report stays with its job and goes when the job is swept (see [storage.md](storage.md#cleanup)).
- At the start of each turn the brain reads the always-loaded kinds once. Every step of the turn
  puts them in the system prompt under "What you know", grouped as instructions, about the owner,
  each line `- [id] text`.
  The id lets Scout use `replaces` or `forget`.
- `soul.md` tells Scout to save instructions, to use `watch` for anything to keep an eye on, to prefer `replaces` over a
  near-duplicate, and to `recall` before saying it does not know.
- Storage is one `memories` table plus an FTS5 index kept in step by triggers; every table in
  `tagalong.db` is mapped in [storage.md](storage.md#tables-and-relations). The schema version
  is `PRAGMA user_version`, set by the numbered files in `brain/src/brain/store/migrations/`
  (see [storage.md](storage.md#store-layer)); a file from a newer brain stops the brain at start. A Python build
  without FTS5 also stops it, with a message.

### Loops

Loops are `loop` rows in the work tree (migration 23): `work` holds the title, deadline and state,
`work_loop` the source, thread ref, people, anchors, asks and the snooze time, and `work_events`
the history notes and the "surfaced" marks. How far each app's mail was read, and whether reading
is on, live in `app_cursors` and `apps.reads_mail`; the daily digest is the `loop-digest` watch.
`loops/store.py` only translates between a `Loop` and those rows. Text is masked before it is
saved. Forgetting a loop deletes its rows; wiping deletes every loop and the mail cursors. See
[storage.md](storage.md#work_loop) and [Loops](brain.md#loops).

### Saved chat

- Every turn end saves its messages to a `messages` table (migration 2) with its own FTS index.
  Screenshots and PDFs are stored only as the markers `[screenshot]` and `[document]`.
- On start the history is rebuilt from it: from the turn of the latest compaction block, at most
  50 messages trimmed to whole turns (if the newest turn alone is over 50, it is kept whole;
  server-side compaction bounds its size). A tool call left unanswered by a crash is closed as
  "cancelled", and that result is stored on the next save. A crash mid-turn loses that turn's
  unsaved messages.
- Each compaction block's text becomes one `summary` memory (an episodic `day` entry, search-only, written by code), once
  per block.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#808080", "arrowheadColor": "#808080", "secondaryColor": "#f2f2f2", "tertiaryColor": "#ffffff", "clusterBkg": "#f7f7f7", "clusterBorder": "#808080", "edgeLabelBackground": "#ffffff", "titleColor": "#808080", "actorBkg": "#ffffff", "actorBorder": "#000000", "actorTextColor": "#000000", "actorLineColor": "#808080", "signalColor": "#808080", "signalTextColor": "#808080", "sequenceNumberColor": "#ffffff", "labelBoxBkgColor": "#ffffff", "labelBoxBorderColor": "#808080", "labelTextColor": "#000000", "loopTextColor": "#808080", "noteBkgColor": "#f7f7f7", "noteBorderColor": "#808080", "noteTextColor": "#000000", "activationBkgColor": "#f7f7f7", "activationBorderColor": "#808080", "fontFamily": "Segoe UI, Helvetica, Arial, sans-serif"}}}%%
flowchart LR
    M[model] -->|remember, forget| T[tools.py]
    T --> S[(tagalong.db)]
    S -->|always-loaded kinds, once per turn| P[system prompt]
    P --> M
    M -->|recall| T
    T -->|search| S
    SE[session] -->|save each turn| MS[(messages table)]
    MS -->|rebuild on start| R[resume]
    R --> SE
    MS -->|recall chat| T
```

## Watches

A standing check is a `watch` work row, not a memory (storage.md, `work_timer`). Scout adds one with
the `watch` tool (`add` with a note and `every_minutes`, at least 5), lists them, `pause`s,
`switch_on`s or `cancel`s one. A watch wakes Scout as a `timer` event every `every_minutes` until it
is cancelled or paused; a paused watch never fires. The old `tracking` memories became paused
watches; on the first start after the update Scout is told once (`watches_paused`) and offers to
switch each on.
