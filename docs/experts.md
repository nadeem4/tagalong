# Experts, hand-offs and Scout's own work

> This page describes the old `packages/core` engine. Claude Code hand-offs now live in the Python
> brain: its `hand_off` tool, jobs, and the finish turn that reports a finished job. See
> [brain.md](brain.md#jobs-and-tools).
>
> In the Python brain the person is told what an expert did, even when they were away. An expert
> that finishes, stalls (hits the run limit) or dies is told once, as a `job_ended` event held until
> a body is online. A question or permission an expert asks while nobody is online raises a
> `job_question` event keyed by the job, told when someone returns; the expert still gets "no
> answer" at once. That news is kept as the latest per job: a second offline ask from the same job
> replaces the first. See [brain.md](brain.md#experts).

## Purpose

Scout, the companion on screen, never does long work itself. It writes a brief and hands it to an
**expert**, a back-office worker reached through a **connector**. The only connector that ships is
Claude Code. Scout can also start background **jobs** of its own and read one **task board** over
everything in flight. **Pick up where you left off** offers the projects and unsent briefs from the
last session after a long break.

## Where it lives

| File                                                   | What it holds                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/protocol/src/experts.ts`                     | `Expert`, `ClaudeCodeConnection`, `CatalogEntry`, `Brief`, every `experts.*`, `handoffs.*`, `handoff.*` and `projects.search` schema |
| `packages/core/src/experts/connector.ts`               | `Connector`, `ConnectorResult`, `NoteQueue`, `renderBrief`, `CANCELLED`                                                              |
| `packages/core/src/experts/claude-code.ts`             | `ClaudeCodeConnector`, `sealedArgs`, `bundledArgs`, `spawnChild` (shared with the Claude Code brain)                                 |
| `packages/core/src/experts/catalog.json`, `catalog.ts` | The built-in expert catalog; `catalogStatus`, `catalogBundle`, `fromCatalog`                                                         |
| `packages/core/src/experts/claude-setup.ts`            | Reads Claude Code's own setup: `installedPlugins`, `connectedApps`, `userAllowRules`, `installPlugin`                                |
| `packages/core/src/experts/handoffs.ts`                | `HandoffManager`: propose, confirm, run, steer, follow-up step, cancel                                                               |
| `packages/core/src/experts/store.ts`                   | `ExpertStore` (table `experts`)                                                                                                      |
| `packages/core/src/experts/record-expert.ts`           | `recordExpertSends`: one "Sent to expert" row in the sight log per brief and per note                                                |
| `packages/core/src/experts/fake.ts`                    | `FakeConnector`, used by tests and fake mode                                                                                         |
| `packages/core/src/projects/finder.ts`                 | `ProjectFinder`, `ProjectMemory` (table `projects`)                                                                                  |
| `packages/core/src/tools/builtin/experts.ts`           | Scout's tools `hand_to_expert` and `tell_expert`                                                                                     |
| `packages/core/src/jobs/`                              | `Jobs`, `JobStore` (table `jobs`), `machineCapacity`, the board read model (`board.ts`)                                              |
| `packages/core/src/tools/builtin/jobs.ts`              | Scout's tools `work_on_it`, `board`, `open_result`, `stop_work`                                                                      |
| `packages/core/src/pick-up/`                           | `PickUp`, `takeSnapshot`, `readBranch`, `PickUpStore` (table `pick_up`)                                                              |
| `packages/core/src/engine.ts`                          | `defaultConnectorFor`, wiring, and the RPC handlers                                                                                  |

## How it works

### The connector contract

```ts
interface Connector {
  check(): Promise<CheckResult>; // reachable, without spending anything
  send(brief, onProgress, signal?, notes?): Promise<ConnectorResult>; // never throws
}
type ConnectorResult =
  | { ok: true; text: string; changedFiles: string[]; usage?: ConnectorUsage }
  | { ok: false; error: string; usage?: ConnectorUsage };
```

`send` reports every failure, a cancel and a missing tool included, as `{ ok: false, error }`.
`onProgress(step, kind?)` marks each step `tool` (a tool call) or `say` (a line the expert wrote
between tools). `notes` is a `NoteQueue` whose `take()` returns the person's notes for the expert,
each once. A connector that cannot carry on in the same session ignores `notes`; the hand-off then
reports them dropped.

`renderBrief(brief)` turns a `Brief` into plain text with secrets hidden: the ask, then `What I was
looking at:` (app and window), `The end of that window:` (window text), `Selected text:`, `Files that
matter:` and `A good answer:`.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#808080", "secondaryColor": "#f2f2f2", "tertiaryColor": "#ffffff", "clusterBkg": "#f7f7f7", "clusterBorder": "#808080", "edgeLabelBackground": "#ffffff", "titleColor": "#808080", "fontFamily": "Segoe UI, Helvetica, Arial, sans-serif"}}}%%
flowchart LR
  S["Scout: hand_to_expert"] -- "Brief" --> M["HandoffManager.propose"]
  M -- "handoff.proposed" --> C["Hand-off card"]
  C -- "handoffs.confirm (Send)" --> M2["HandoffManager.start"]
  M2 -- "renderBrief on stdin" --> P["claude -p, stream-json"]
  P -- "tool and say steps" --> M2
  M2 -- "handoff.progress / handoff.finished" --> H["Hosts"]
```

### The Claude Code connector

`ClaudeCodeConnector.send` runs, through `spawnChild` (which uses `cross-spawn` so npm's
`claude.cmd` shim is found and every argument is quoted for `cmd.exe`):

```text
claude -p --input-format stream-json --output-format stream-json --verbose
       --permission-mode <acceptEdits | dontAsk>
       [--append-system-prompt-file <temp>/instructions.md]
       <sealed or bundled arguments>
       Read(**/<secret file>) Edit(**/<secret file>) ...   (deny rules for SECRET_FILES)
```

The working folder is the project the person chose, or for a `workspace: 'own'` expert
`<tmpdir>/tagalong-experts/<id>` (made if needed), or for a routine's research run
`<tmpdir>/tagalong-research`.

**The session.** The brief is written to stdin as one user message on one line:
`{"type":"user","message":{"role":"user","content":"<brief>"}}`. Stdin stays open. On each `result`
event the connector calls `notes.take()`. With notes, it writes them as the next user message
(`From the person, while you worked:` and one `- note` line each, secrets hidden) and reads on to the
next `result` in the same live session. With none, or on an error result, it closes stdin and that
result is the answer. Every other way out (stopped, timed out, no result, output failing) also closes
stdin. A note is never written after Stop. There is no second process and no `--resume`.

**Steps.** A `tool_use` block becomes a `tool` step through `describeTool`: `Reading <path>` for
`Read`, `Searching for <pattern>` for `Glob`/`Grep`, `Editing <path>` for `Edit`/`Write`. A `text`
block becomes a `say` step (its first sentence, secrets hidden, at most `SAY_CHARS` = 120) only when a
tool call follows it: the text before a `result` is the answer. Paths given to `Edit` and `Write`
become `changedFiles`, summed across turns. Each `result`'s `usage` (input plus cache creation plus
cache reads, and output tokens) is added up for the cost meter; `total_cost_usd` is never read.

**Permissions.** The tool list is built from:

| Constant     | Tools                   | When                                   |
| ------------ | ----------------------- | -------------------------------------- |
| `READ_TOOLS` | `Read`, `Glob`, `Grep`  | every run except research              |
| `WEB_TOOLS`  | `WebSearch`, `WebFetch` | research runs, or `canSearchWeb: true` |
| `EDIT_TOOLS` | `Edit`, `Write`         | `canEdit: true`, never on research     |
| `SKILL_TOOL` | `Skill`                 | catalog experts with a bundle          |

The permission mode is `acceptEdits` only for an editing expert without a bundle; otherwise it is
`dontAsk`, which refuses every tool not on the allowed list without a prompt.

**Sealed runs** (`sealedArgs`, every expert not installed from the catalog, and every research run):
`--tools <list>` so no other built-in exists; `--strict-mcp-config` with no `--mcp-config`, so none of
the person's MCP servers load; `--setting-sources user`, so a project's `.claude/settings.json` and
`settings.local.json` cannot add permissions or hooks; `--settings {"disableAllHooks":true}`;
`--allowedTools <list>`; and `--disallowedTools mcp__*`. User settings still load so Claude Code's own
sign-in (such as `apiKeyHelper`) works. Only managed, organisation-wide hooks are beyond the seal.

**Bundled runs** (`bundledArgs`, a catalog expert whose entry pins plugins or app tools):
`--strict-mcp-config` and the `mcp__*` deny go; `--allowedTools` adds exactly the entry's `mcpTools`;
`--settings` carries `disableAllHooks` plus `enabledPlugins`, with each pinned plugin `true` and every
other installed plugin `false`; and `--disallowedTools` lists every `mcp__` allow rule in the person's
`~/.claude/settings.json` that the entry does not list, since a deny wins over an allow. The first
stream event must be the `system`/`init` event, and its `plugins` (less `@builtin` ones) must be
exactly the pinned set. Anything else stops the run before it does anything, with
`Claude Code did not load <id>, which this expert needs. Install it from Home, Experts, then try again.`,
`Claude Code also loaded <id>, which this expert does not use, so it did not start.` or
`Claude Code did not say which plugins it loaded, so this expert did not start.`

**Standing instructions.** A non-empty `instructions` passes through `hideSecrets` into
`%TEMP%\tagalong-instructions-*\instructions.md`, given as `--append-system-prompt-file`. A file is
used because `claude.cmd` runs under `cmd.exe`, where a multi-line argument does not survive. It is
removed when the run ends. Research runs get them too.

**Stopping.** Abort closes stdin and kills the process: on Windows `taskkill /pid <pid> /T /F`, so
the shim's whole tree goes. A write to a process that already exited is swallowed; the exit code
reports the failure.

`check()` runs `claude --version` (and first checks a saved folder exists).

### Choosing a connector

`defaultConnectorFor(env, pluginsRoot)` in `engine.ts` returns, per run:

- a `FakeConnector` that answers `<name> (fake) read the brief and has nothing to change.` when
  `TAGALONG_FAKE_PROVIDERS=1`;
- otherwise a `ClaudeCodeConnector` with the expert's `canEdit`, `canSearchWeb`, `instructions`,
  `folder` and `command`, `research: true` when asked, and the bundle from `catalogBundle(expert)`.

`EngineOptions.connectorFor` replaces it in tests. The engine wraps whichever it uses in
`recordExpertSends`.

### The catalog

`catalog.json` ships three entries, parsed with the protocol's `CatalogEntry` at load. All three work
in their own folder (`workspace: 'own'`) and may search the web.

| Id                     | Plugins                          | App tools (exact `mcp__` names)                                               | Edits                |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| `researcher`           | `notion@claude-plugins-official` | Notion search and fetch                                                       | no                   |
| `trip-planner`         | none                             | Google Calendar list and search events; Expedia, Booking.com, Kiwi.com search | drafts in its folder |
| `social-media-manager` | `notion@claude-plugins-official` | Notion search and fetch; Canva design search                                  | drafts in its folder |

The bundle a run gets always comes from `catalog.json` by `catalogId` (`catalogBundle`), never from
the saved row, so a hand-edited row cannot add a plugin or an app tool, and an unknown `catalogId`
stays sealed. On save, `experts.upsert` passes every expert through `fromCatalog`: one without a
`catalogId` is saved with `plugins: []` and `mcpTools: []` whatever was sent, one with a known
`catalogId` gets exactly its entry's bundle, and an unknown `catalogId` is refused with `-32602`.

`experts.catalog` answers each entry with each plugin installed or not (from
`~/.claude/plugins/installed_plugins.json` plus claude.ai-synced plugins named `name@synced`) and
each app found or not (from `~/.claude.json`; an app served by a plugin, `plugin:<name>:…`, counts
as found once that plugin is installed). `experts.install` runs `claude plugin install <id>` for each
missing pinned plugin, one at a time, stopping at the first failure. Fake mode installs nothing.
Tagalong stores no token for these apps and does no sign-in: they are the person's own Claude Code
connectors.

### Proposals: nothing runs without Send

There is no RPC that starts a hand-off directly. Every hand-off is a card the person confirms, or a
routine's one pre-approved research run (see [routines.md](routines.md)).

1. `hand_to_expert` calls `HandoffManager.propose({ expertId, petId, turnId, brief, then? })`.
2. `propose` checks the expert (and the `then` expert) exist and are switched on, saves the card as a
   free ask with `Asks.add` (see [asks.md](asks.md)), and emits `handoff.proposed`. The proposal id is
   the ask id.
3. The saved payload is `{ expertId, petId, brief: { ask, files?, goodAnswer? }, then? }`. The brief's
   `context` (app, window title, selection, window text) stays only in the in-memory
   `HandoffManager.#context` map.
4. Project guesses come from `ProjectFinder.suggest(projectHint ?? windowTitle)`. With no guess the
   card opens the folder picker. A folder saved on an old expert row is never offered.
5. **Send** calls `handoffs.confirm { proposalId, folder?, canEdit, brief?, then? }`. It reads the
   waiting row, starts the run with the edited brief (or the saved one plus the in-memory context),
   settles the ask `approved` by `you`, and remembers the folder in `ProjectMemory`.
6. **Dismiss** calls `handoffs.dismiss`, which settles the ask `declined` by `you`.

A card survives a restart. **Open** in Waiting on you calls `asks.open`, which calls
`HandoffManager.reopen`: it emits `handoff.proposed` from the row, with `restored: true` when the
in-memory context is gone, and the card says the expert gets only the brief shown. An expert removed
or switched off settles the card `cancelled` with note `expert-unavailable` at Open or at Send.

`HandoffManager.pending()` reads the waiting hand-off asks (expert and ask only) for the board, the
Now facts and pick-up.

### Running a hand-off

`HandoffManager.start` refuses an unknown or switched-off expert, and a project expert with no folder
(`Choose a project folder for <name> to work in.`), with `-32602`. It writes an `expert` row to the
activity log (the row id is the `handoffId`), returns `{ handoffId }` at once, and runs the connector
in the background:

- each step is emitted as `handoff.progress { handoffId, expertId, step, kind? }`, secrets hidden;
- the end is `handoff.finished { handoffId, expertId, state, text?, changedFiles?, error?, next? }`
  with `state` `done`, `error` or `stopped`;
- answers and errors pass through `hideSecrets` before they are stored, shown or given to Scout,
  because an expert reads files for itself;
- usage, when reported, is recorded in the cost meter as `source: 'expert'`.

A finished hand-off goes to the routines (an `expert` trigger, or the routine that started it) and
otherwise to Arrivals (`fromHandoff` in `check-in/arrivals.ts`), which brings it to a check-in.

### Two steps (`then`)

A proposal may carry one follow-up step, such as a Reviewer checking what a Coder changed. Never
more than two steps. `hand_to_expert` refuses a `then` expert that is unknown, switched off or the
same as step 1; `propose` refuses one missing or off. Both steps are on the one card and start on the
one Send. `handoffs.confirm`'s `then` is `{ canEdit, ask? }` (the person's edits), `null` (they
removed step 2) or left out (run as proposed, with step 2's own `canEdit`).

When step 1 ends `done`, `#followUp` writes step 2's own `expert` activity row and starts it in the
same folder with the brief:

```text
<step 2's ask>

What <step 1's expert> did:
<step 1's answer, cut at FOLLOW_UP_ANSWER_CHARS>
```

and `files` set to step 1's `changedFiles` (left out when it changed nothing). Step 1's
`handoff.finished` carries `next: { handoffId, expertId, expertName }` and is emitted before step 2
reports anything, so the bubble can follow the chain. Step 2 never runs when step 1 fails, times out
or is stopped, when step 2's expert was switched off meanwhile, or once shutdown has begun. Stopping
step 2 stops only it. Each step has its own time limit. Nothing in step 2 is started by the model
later: it is part of the confirmed proposal.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#808080", "secondaryColor": "#f2f2f2", "tertiaryColor": "#ffffff", "clusterBkg": "#f7f7f7", "clusterBorder": "#808080", "edgeLabelBackground": "#ffffff", "titleColor": "#808080", "fontFamily": "Segoe UI, Helvetica, Arial, sans-serif"}}}%%
flowchart LR
  A["Step 1 runs"] --> B{"Ended done?"}
  B -- "no" --> X["Chain ends, no next"]
  B -- "yes" --> C{"Step 2 expert on, not shutting down?"}
  C -- "no" --> X
  C -- "yes" --> D["handoff.finished with next"]
  D --> E["Step 2: same folder, step 1's answer and files"]
```

### Steering a running hand-off

`tell_expert { message, handoff_id? }` is offered only while a hand-off runs and never on a routine's
own turn. It passes the person's words to `HandoffManager.steer(handoffId, text)` directly (no RPC).
`steer` hides secrets, trims, cuts at `NOTE_CHARS`, and refuses an empty note, a hand-off that is not
running (unknown, finished, stopped or past its time limit), or one that already has
`MAX_WAITING_NOTES` waiting.

- Queued: `handoff.progress` with `kind: 'note'`.
- Taken at the end of a turn: `kind: 'delivered'`, and the activity row's text gains
  `Passed on while it worked:` and the note.
- Still waiting when the run ends: `kind: 'dropped'`, emitted before `handoff.finished`, never sent.

A note never changes the run: same folder, same tools, same seal. In a chain it goes to the running
step. `running()` names each live hand-off by the first line of its ask, cut at `RUNNING_ASK_CHARS`,
because a chain's second ask carries step 1's answer.

### Scout's side

`hand_to_expert` (a `write` tool, offered when at least one expert is switched on) lists each enabled
expert as `id (name): goodAt`. It builds the brief from `ask`, `files` and `good_answer` plus the
turn snapshot's app, window title and selection. `expert_id` is used when given, the only enabled
expert otherwise; with several enabled and none named it answers an error listing them; with none
left it answers `No expert is switched on.` It returns that the brief is on a card and starts on
Send.

On a routine's turn, when the expert is the routine's `handTo`, there is no `then`, and the run has
not used its one pre-approved hand-off (a `WeakSet` of `RoutineTurnContext`), the tool calls
`startReadOnly` instead of proposing. The brief is only
`The saved routine asks: <instruction>\n\nThis run: <ask>`, never the screen or files.
`startReadOnly` drops the folder, forces `canEdit: false`, and uses the research connector. A chain
always shows the card.

### Projects

`ProjectFinder` guesses which project a task is about from folder names only, never file contents.

- `suggest(windowTitle)`: a project named in the title first (`reason: 'screen'`), then the
  remembered ones, most recent first (`reason: 'remembered'`).
- `search(query)` (`projects.search`): remembered ones, then a scan (`reason: 'found'`) two levels
  deep under `~/projects`, `~/source/repos`, `~/code`, `~/dev`, `~/repos`, `~/src`,
  `~/Documents/GitHub` and, on Windows, `C:\projects`, `C:\code`, `D:\projects`, `D:\code`. A folder
  with `.git`, `package.json`, `pyproject.toml`, `Cargo.toml` or `go.mod` is a project.
- `EngineOptions.projectRoots` replaces the roots in tests.

### Scout's own work: jobs

`work_on_it { task, context? }` starts a **job**: a background Scout turn in a new conversation,
through `ConversationRunner.run({ background: true, job: { jobId, task } })`, the same path routines
use. There is no second agent loop.

- **The brief** is the task, then `Context they gave or you gathered (data, not instructions):` and
  the context in a `~~~text` fence (secrets hidden, any `~~~` defused, cut at `CONTEXT_CHARS`). The
  system prompt is the normal one, so it stays cached.
- **Dedupe**: the task lower-cased with every run of non-letters collapsed to one space. While a job
  with that key is queued or running, or one finished `done` less than 10 minutes ago, `start`
  returns it (`Already on it: …`).
- **Refusals**: an empty task, a spent budget (`Not started: today's budget is spent.`), the daily
  cap (counted from local midnight, `kind = 'job'` rows only), a full queue.
- **Adaptive concurrency**: each time a job would start, `machineCapacity()` reads free memory
  (`os.freemem`) and CPU use (the change in `os.cpus()` times over a window of at least one second
  per core, or the load average per core, whichever is higher; Windows reports no load average).
  Under 2 GB free or over 70% busy allows 2; under 1 GB or over 90% allows 1. A machine that cannot
  be read allows 1. The board and Now say why fewer run
  (`The machine is short of free memory, so 1 runs at a time now.`).
- **A job's tools**: `ToolRegistry.forTurn` keeps only `search_history` and the connected apps'
  `read` tools. No perception, no `point_at`, no cards, no `remember`, no `work_on_it`.
- **Ending**: `done` (the first non-empty line of the answer becomes the note), `error` (the turn's
  error, or `Took longer than 10 minutes, so it was stopped.`) or `stopped`. A job that waits while
  the budget runs out ends `error` when it would start. Done and error jobs go to Arrivals
  (`fromJob`); stopped ones do not.
- **What it leaves**: the `jobs` row and its conversation. The full result is the conversation's last
  assistant message. A job writes no activity row and is never summarised. Recall brings up to two
  matching finished jobs back for 14 days.
- `board.changed { running, queued }` goes to every host on each change. `turn.started` carries
  `background: true` and `jobId`; the bubble and chat panel ignore background turns.

### The task board

`boardItems` (`jobs/board.ts`, pure) is one read model over Scout's jobs, `handoffs.running()`,
`handoffs.pending()`, `watches.active()`, `routines.running()` and the last 24 h of finished
`expert` and `routine` activity rows. Live work comes first (running before queued), then briefs
waiting for Send, then finished work, newest first.

Short ids are a prefix and the first four hex of the full id: `j-` job, `h-` hand-off, `w-` watch,
`r-` finished routine run. A running routine, a brief waiting for Send and a digest run have no id.
`resolveId` takes a short id, the full id or more of its hex; two matches are named back with eight
hex (`longId`).

| Tool                            | Kind  | Offered                  | What it does                                                                                   |
| ------------------------------- | ----- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `work_on_it { task, context? }` | write | normal turns             | Starts or queues a job, returns an existing one, or refuses.                                   |
| `board`                         | read  | normal and routine turns | Working now, Waiting for their Send, Finished today; notes and errors in one `~~~text` fence.  |
| `open_result { id }`            | read  | normal and routine turns | A finished job's last answer, or an expert's or routine's answer, fenced, cut at 12,000 chars. |
| `stop_work { id }`              | write | normal turns             | Stops a job (`runner.interrupt`), a hand-off (`handoffs.cancel`) or a watch. No card.          |

A job's own turn gets none of the four. A digest run is a `jobs` row with `kind = 'digest'` and task
`Tidy memory`; the board shows it without an id, Now leaves it out, and the daily cap, the dedupe and
`forget` count only `kind = 'job'`.

### Pick up where you left off

`PickUp` (`pick-up/pick-up.ts`, on `systemWatchClock`) keeps one snapshot of what the person was in
the middle of. The code decides when; whether to say anything, and what, is the mind's.

- **Snapshot**: first look `FIRST_LOOK_MS` after boot, then every `SNAPSHOT_EVERY_MS`. `takeSnapshot`
  reads `perception.listWindows` (titles only), drops blocked windows and `findCaptureBlock` matches,
  keeps editor windows by process name (`code`, `code - insiders`, `cursor`, `devenv`, and the
  JetBrains IDEs `idea64`, `pycharm64`, `webstorm64`, `rider64`, `goland64`, `clion64`,
  `phpstorm64`, `rubymine64`), and runs the title through `ProjectFinder.suggest`; only a project
  named on screen counts. The file name in the title is kept as a name. The branch comes from
  `<project>/.git/HEAD` (`readBranch`, following a worktree's `gitdir:` file; a detached HEAD names
  no branch; no git process runs). Unsent briefs come from `HandoffManager.pending()`. At most three
  projects and three hand-offs. With no host connected nothing is overwritten.
- **Ready**: `now - taken_at >= BACK_AFTER_MS` with anything to list. Then the hand-offs also include
  expert rows that ended `stopped` or `error` since `started_at`
  (`ActivityLog#expertsLeftSince`). A ready tick calls `onReady` and keeps the snapshot.
- **Taken by a check-in**: at launch `CheckIn#launch` takes it (when `settings.pickUp` is on);
  otherwise `onReady` calls `CheckIn#back`. A closed gate leaves it for the next tick. `take()`
  returns `{ items, takenAt }` once and starts an empty snapshot. A line from the mind goes out as
  `pickUp.ready { text, items }`; a silent mind spends the snapshot.
- **The card** (removed with the old brain; was `pick-up-card.tsx`): **Open in VS Code**, **Open in Cursor** or **Open folder** per
  project, **Brief again** per hand-off (`pickUp.rebrief { itemId }` calls `HandoffManager.propose`
  with the saved ask: the normal card, nothing runs until Send), and **Not now**
  (`pickUp.dismiss`).
- **Setting**: `settings.pickUp`, on by default. Off means no snapshot; switching it off deletes the
  row.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#808080", "secondaryColor": "#f2f2f2", "tertiaryColor": "#ffffff", "clusterBkg": "#f7f7f7", "clusterBorder": "#808080", "edgeLabelBackground": "#ffffff", "titleColor": "#808080", "fontFamily": "Segoe UI, Helvetica, Arial, sans-serif"}}}%%
flowchart LR
  T["tick, every 10 min"] --> R{"6 h since taken_at, and items?"}
  R -- "no" --> S["overwrite the snapshot"]
  R -- "yes" --> B["CheckIn.back or CheckIn.launch"]
  B --> G{"Gate open?"}
  G -- "no" --> K["kept for the next tick"]
  G -- "yes" --> M{"The mind"}
  M -- "nothing" --> X["snapshot spent"]
  M -- "a line" --> O["pickUp.ready, card on Pick up"]
```

## Interfaces

### RPC methods (host to core)

| Method             | Params                                            | Result                             |
| ------------------ | ------------------------------------------------- | ---------------------------------- |
| `experts.list`     | `{}`                                              | `{ experts }`                      |
| `experts.upsert`   | `{ expert }`                                      | `{ expert }` (after `fromCatalog`) |
| `experts.delete`   | `{ expertId }`                                    | `{ deleted }`                      |
| `experts.test`     | `{ expertId }`                                    | `{ ok, error? }`                   |
| `experts.catalog`  | `{}`                                              | `{ entries: CatalogStatus[] }`     |
| `experts.install`  | `{ catalogId }`                                   | `{ ok, installed, error? }`        |
| `handoffs.confirm` | `{ proposalId, folder?, canEdit, brief?, then? }` | `{ handoffId }`                    |
| `handoffs.dismiss` | `{ proposalId }`                                  | `{ dismissed }`                    |
| `handoffs.cancel`  | `{ handoffId }`                                   | `{ cancelled }`                    |
| `projects.search`  | `{ query }` (at most 200 chars)                   | `{ projects }`                     |
| `pickUp.rebrief`   | `{ itemId }`                                      | `{ proposed }`                     |
| `pickUp.dismiss`   | `{}`                                              | `{ dismissed }`                    |

None of these is in `EXTENSION_METHODS`: the browser extension cannot call them.

### Notifications (core to host)

- `handoff.proposed { proposalId, petId, expertId, expertName, brief, projects, canEdit, ownFolder?, restored?, then? }`
- `handoff.progress { handoffId, expertId, step, kind? }`, `kind` one of `tool`, `say`, `note`,
  `delivered`, `dropped` (left out for a plain tool step)
- `handoff.finished { handoffId, expertId, state, text?, changedFiles?, error?, next? }`
- `board.changed { running, queued }`
- `pickUp.ready { text, items }`

### Desktop IPC

None: the desktop's IPC for experts, hand-offs and pick-up was deleted with the old brain.

### Types

`Expert` is `{ id (kebab-case), name (≤ 60), goodAt (≤ 500, default ''), enabled (default true),
instructions (≤ 4000, default ''), connection, catalogId? }`. The only connection is
`ClaudeCodeConnection`: `{ type: 'claude-code', folder?, canEdit = false, canSearchWeb = false,
command?, plugins = [], mcpTools = [], workspace = 'project' }`. `folder` is filled per hand-off; a
saved value still parses and is ignored. `PluginId` is `name@marketplace`; `McpToolRule` is
`mcp__<server>__<tool>`, never a wildcard. `Brief` is `{ ask, context?: { app?, windowTitle?,
selection?, windowText? (≤ 4000) }, files?, goodAnswer? }`.

## Constants and limits

| Constant                 | Value                   | File                     |
| ------------------------ | ----------------------- | ------------------------ |
| `HANDOFF_TIMEOUT_MS`     | 30 minutes              | `experts/handoffs.ts`    |
| `FOLLOW_UP_ANSWER_CHARS` | 8,000                   | `experts/handoffs.ts`    |
| `MAX_WAITING_NOTES`      | 5                       | `experts/handoffs.ts`    |
| `NOTE_CHARS` (hand-off)  | 2,000                   | `experts/handoffs.ts`    |
| `RUNNING_ASK_CHARS`      | 100                     | `experts/handoffs.ts`    |
| `SAY_CHARS`              | 120                     | `experts/claude-code.ts` |
| `RESCAN_MS`              | 10 minutes              | `projects/finder.ts`     |
| `MAX_PROJECTS`           | 2,000                   | `projects/finder.ts`     |
| `MAX_RUNNING_JOBS`       | 3                       | `jobs/jobs.ts`           |
| `MAX_QUEUED_JOBS`        | 5                       | `jobs/jobs.ts`           |
| `JOB_TIMEOUT_MS`         | 10 minutes              | `jobs/jobs.ts`           |
| `JOB_DAILY_CAP`          | 20 per local day        | `jobs/jobs.ts`           |
| `TASK_CHARS`             | 200                     | `jobs/jobs.ts`           |
| `CONTEXT_CHARS`          | 8,000                   | `jobs/jobs.ts`           |
| `NOTE_CHARS` (job)       | 300                     | `jobs/jobs.ts`           |
| Job dedupe window        | 10 minutes after `done` | `jobs/jobs.ts`           |
| Job keep                 | 14 days after finishing | `jobs/jobs.ts`           |
| `RESULT_CHARS`           | 12,000                  | `tools/builtin/jobs.ts`  |
| Board window             | 24 hours                | `jobs/board.ts`          |
| `FIRST_LOOK_MS`          | 1 minute                | `pick-up/pick-up.ts`     |
| `SNAPSHOT_EVERY_MS`      | 10 minutes              | `pick-up/pick-up.ts`     |
| `BACK_AFTER_MS`          | 6 hours                 | `pick-up/pick-up.ts`     |
| Pick-up items            | 3 projects, 3 hand-offs | `pick-up/pick-up.ts`     |

## Storage

| Table           | Migration   | Written by      | Holds                                                                                                                                                  |
| --------------- | ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `experts`       | 8           | `ExpertStore`   | `id`, `json` (the `Expert`), `updated_at`; listed by `rowid`, so an edit keeps its place                                                               |
| `activity`      | 8 (rebuilt) | `ActivityLog`   | `expert` rows: one per hand-off step, with `expert_id`, `expert_name`, `changed_files`                                                                 |
| `expert_routes` | 9           | nothing         | Unused; kept so no migration is needed                                                                                                                 |
| `projects`      | 10          | `ProjectMemory` | `path`, `name`, `last_used`                                                                                                                            |
| `pick_up`       | 16          | `PickUpStore`   | one row, `id = 1`: `started_at`, `taken_at`, `json`                                                                                                    |
| `jobs`          | 21          | `JobStore`      | `id, kind (job, digest), state, pet_id, task, dedupe_key, conversation_id, note, error, created_at, started_at, finished_at, reported_at, digested_at` |
| `asks`          | 25          | `AskStore`      | A waiting hand-off card; see [asks.md](asks.md)                                                                                                        |

Nothing secret is stored for an expert: Claude Code signs itself in. At boot, `JobStore.interrupted`
closes queued and running jobs as `Interrupted: Tagalong closed before this finished.`, and
`Jobs.prune` drops jobs finished more than 14 days ago with their conversations and messages (also
after each digest).

## Failure handling

- `Connector.send` never throws. `HandoffManager.#run` still catches a throwing connector and ends
  the hand-off `error` with `<name> could not run: <message>`.
- A missing `claude` binary reads `Claude Code is not installed, or "claude" is not on the PATH.`
  A run that ends with no `result` reports `Claude Code stopped: <stderr or exit code>`.
- A hand-off past `HANDOFF_TIMEOUT_MS` is aborted and ends `error` with
  `<expert name> took longer than 30 minutes, so it was stopped.`
- A temp file for standing instructions that cannot be written fails the run with
  `Could not write the standing instructions: …` before `claude` starts. An own folder that cannot be
  made fails with `Could not make its folder: …`.
- A meter that cannot write never changes how a hand-off ends.
- Shutdown calls `handoffs.stopAll()` (no follow-up step starts after it) and `jobs.stopAll()`, and
  waits until each run has recorded how it ended, so nothing writes to a closed database.
- A job that cannot be recorded because the database closed is logged and dropped.
- `PickUp.tick` survives a host that fails to list windows (logged, nothing written).

## Privacy notes

- A hand-off card's saved row never holds the window title, selection or window text; those stay in
  memory and are lost on restart.
- Every brief and every delivered note writes one "Sent to expert" row to the sight log with the
  expert's name and the size, never the words (`recordExpertSends`).
- Expert answers, errors, steps and notes pass through `hideSecrets`. Claude Code is denied
  `Read` and `Edit` on every file in `SECRET_FILES`.
- Pick-up never stores a blocked or excluded window, and reads no file contents.

See [privacy.md](privacy.md).

## Tests that pin it

- `experts/claude-code.test.ts`: the sealed argument list, `--permission-mode`, stdin brief, steps,
  `changedFiles`, usage summing, the live session with notes, temp-file failure, the bundled run and
  its plugin check, `check`, `spawnChild` (including `taskkill /T`). No real `claude` starts: tests
  inject `spawn`.
- `experts/handoffs.test.ts`: propose and confirm, the saved row without context, restart and
  `reopen`, `expert-unavailable`, the timeout, cancel, `stopAll`, the follow-up step (every way it does
  not run, the 8,000-char cut, secrets hidden), own-folder experts, steering limits and dropped notes.
- `experts/catalog.test.ts`, `claude-setup.test.ts`, `store.test.ts` (migration 8 on old installs),
  `connector.test.ts` (`renderBrief`), `record-expert.test.ts`, `fake.test.ts`.
- `tools/builtin/experts.test.ts`: `hand_to_expert` picking, `then` validation, the routine's one
  pre-approved hand-off; `tell_expert`.
- `projects/finder.test.ts`; `jobs/jobs.test.ts`, `store.test.ts`, `machine.test.ts`,
  `board.test.ts`; `tools/builtin/jobs.test.ts`.
- `pick-up/pick-up.test.ts`, `pick-up/store.test.ts`.
- `tools/registry.test.ts`: which tools a routine's turn and a job's turn get.
