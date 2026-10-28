# The Python brain

The brain is the Python side of contract v1 ([protocol/README.md](../protocol/README.md)). It is
being built row by row and replaces `packages/core`. Today bodies can connect, declare their tools,
catch up on missed notifications, and talk to Scout: `say` starts a turn and the reply streams
back. Scout can use the tools bodies declare, and asks the user first before a tool that changes
something (see [Toolbox](#toolbox)). Scout remembers through the `remember`, `recall` and `forget` tools, kept in `tagalong.db`
(see [memory.md](memory.md)). The chat is saved and picked up again after a restart (see [What a turn does](#what-a-turn-does)).

## Run it

```text
cd brain
uv sync
uv run brain
```

It logs one line, `brain listening on ws://127.0.0.1:47321`, and runs until Ctrl+C.

It needs an Anthropic key. With no `ANTHROPIC_API_KEY` in the environment or in
`<TAGALONG_HOME>/.env`, it logs one line saying where to put it and exits with status 1.

| Variable                    | Default            | Meaning                                                                   |
| --------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `TAGALONG_BRAIN_ADDR`       | `127.0.0.1:47321`  | `host:port` to listen on. Port `0` picks a free port                      |
| `TAGALONG_HOME`             | `~/.tagalong`      | Data folder. Holds `session`, `budget.json`, `tagalong.db`, `.env`        |
| `TAGALONG_MODEL`            | `claude-opus-5-5`  | Model Scout thinks with                                                   |
| `TAGALONG_DAILY_BUDGET_USD` | `5`                | Most Scout may spend per local day, in USD                                |
| `TAGALONG_STEP_CAP`         | `25`               | Most model calls in one turn                                              |
| `TAGALONG_EXPERT_CMD`       | `claude-agent-acp` | Command that starts the Claude Code ACP adapter (split like a shell line) |
| `TAGALONG_EXPERT_TIMEOUT_S` | `1800`             | Longest an expert run may take, in seconds                                |
| `ANTHROPIC_API_KEY`         | none, required     | Anthropic key                                                             |

`<TAGALONG_HOME>/.env` holds `KEY=value` lines (`#` comments and quotes allowed). Any
`TAGALONG_*` setting above except `TAGALONG_HOME`, and `ANTHROPIC_API_KEY`, may live there. It only
fills keys the environment lacks, so the environment wins. A bad budget or step cap stops the brain at
start.

The `session` file keeps one id across restarts. `hello` returns it.

`budget.json` holds `{"date": "2026-10-25", "spent_usd": 0.42}` and starts again at zero each
local day. After each model call the brain adds its cost. A model call that would start at or
over the limit ends the turn with `over_budget`. Cost uses the top-level `usage` of the reply
(not `usage.iterations`), priced at the model that actually answered, including a fallback. A cancelled or failed stream records no spend, so
the total can run a little low.

## Files

| File                             | What it does                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brain/src/brain/protocol.py`    | Contract v1 as pydantic types                                                                                                                                    |
| `brain/src/brain/config.py`      | Reads the environment and `.env`, keeps the session id                                                                                                           |
| `brain/src/brain/guardrails.py`  | The daily budget and its `budget.json` ledger                                                                                                                    |
| `brain/src/brain/sessions.py`    | The one conversation: history, the running turn, `say` joins, `cancel`                                                                                           |
| `brain/src/brain/mind/resume.py` | Rebuilds a valid history from the saved chat at start                                                                                                            |
| `brain/src/brain/memory.py`      | Scout's memory: the kinds table and the SQLite store (`tagalong.db`)                                                                                             |
| `brain/src/brain/toolbox.py`     | `Toolbox`: lists and gates every tool call, from `BrainSource`, `AppSource` and `BodySource`                                                                     |
| `brain/src/brain/asks.py`        | `Asks`: opens permission asks (turn-bound) and `open` asks (no turn, custom options, typed answers)                                                              |
| `brain/src/brain/experts.py`     | `ExpertRun`: drives Claude Code in a folder over ACP; callbacks for permissions, questions, progress and the end                                                 |
| `brain/src/brain/jobs.py`        | `Jobs`: hand-off ask, relayed Claude Code asks, the 2-job cap, progress and the `jobs` rows, `changed: jobs`                                                     |
| `brain/src/brain/apps.py`        | `Apps`: connects each enabled app (MCP over stdio or http), keeps it alive, `TokenFile` (`app-tokens.json`), `validate_app`                                      |
| `brain/src/brain/app_tools.py`   | `AppSource` (apps' tools as a toolbox source), tool classification, result fencing, Home's app calls                                                             |
| `brain/src/brain/tools.py`       | The brain's own tools (memory, Home and expert tools) as specs and handlers for `BrainSource`                                                                    |
| `brain/src/brain/mind/soul.md`   | Scout's character, the start of the system prompt                                                                                                                |
| `brain/src/brain/mind/prompt.py` | The system prompt (soul, local time, online bodies, "What you know") and `say` content blocks                                                                    |
| `brain/src/brain/mind/turn.py`   | The thinking loop and the Anthropic streaming call                                                                                                               |
| `brain/src/brain/bodies.py`      | Online bodies, their tools, one outbox per body id, `use` requests and their pending table                                                                       |
| `brain/src/brain/server.py`      | The websocket server: parsing, errors, `hello`, `tools`, `say`, `answer`, `cancel`, replaying open asks, routing `use` responses to `Bodies.resolve`, the writer |
| `brain/src/brain/main.py`        | The `uv run brain` entry point                                                                                                                                   |

## What a connection does

- The first message must be `hello`. Anything else, including bad JSON, gets an error and the
  connection closes.
- A bad `hello` closes the connection. The protocol version is checked first, so a wrong
  version gets `version_mismatch` with `data.protocol` set to `1` even if the rest of the shape
  is wrong; otherwise a bad shape gets `invalid_params`.
- After `hello`, `tools` replaces the body's tool list and answers `{}`. A second `hello` gets
  `invalid_request`. The connection stays open.
- `say` starts or joins a turn (see [What a turn does](#what-a-turn-does)); bad params get
  `invalid_params`. `cancel` with a turn id ends that turn; a turn that is over or unknown is
  ignored. `answer` is described under [Permissions and asks](#permissions-and-asks) and `call`
  under [Home tools](#home-tools). `event`, `progress` and unknown notifications are ignored. An
  unknown request gets `method_not_found`.
- Bad JSON or a binary frame gets `parse_error`. Anything that is not a JSON-RPC object gets
  `invalid_request`. After `hello` the connection stays open; before it, it closes.
- A newer connection with the same body id closes the older one. Its `tools` frames are
  ignored if one still arrives.
- The largest frame is 28,000,000 bytes.

## What a turn does

`say` answers `{turn, joined}` at once. The work then runs in the background and streams
notifications. There is one conversation for all bodies and at most one running turn.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%
flowchart TD
    A[say] --> B{over budget or at step cap?}
    B -->|yes| Z[turn ended]
    B -->|no| C[stream model reply]
    C -->|text| D[reply deltas]
    C -->|failed| Z
    C --> E{stop reason}
    E -->|tool_use| F[run tools together]
    F --> G[add results and joined says]
    G --> B
    E -->|pause_turn| B
    E -->|other| H{joined says waiting?}
    H -->|yes| J[add joined says]
    J --> B
    H -->|no| Z
```

- A `say` while a turn runs joins it: the result has `joined: true` and the message is folded
  into the next step.
- At the start of a turn the always-loaded memories are read once. Every step rebuilds the system
  prompt from Scout's soul, that "What you know" block, the local time, and the bodies online.
- Text streams as `reply` notifications with `delta`. Tools run at the same time, each with
  `tool` `started` then `ended`. The model is offered the memory tools (`remember`, `recall`,
  `forget`) and every online body's tools (see Toolbox); a refused or failed call ends as an error
  result the model reads.
- A turn ends with one of `done`, `cancelled`, `error`, `over_budget` or `step_cap`. A refusal or
  a failed model call is `error`.
- If any delta was sent, exactly one `reply` with `done: true` follows, whatever the end reason.
- History is append-only and always valid: a half-streamed message is never kept, and a
  `tool_use` always gets a `tool_result`, even on cancel.
- Chat is saved at the end of each turn (see [memory.md](memory.md)). A crash mid-turn loses that
  turn's unsaved messages.
- On start the history is rebuilt from the saved chat. It begins at the turn of the latest
  compaction block, is capped at 50 messages trimmed to whole turns (a newest turn over 50 is kept whole), and a tool call left
  unanswered by a crash is closed with a "cancelled" result (stored on the next save).
- Each compaction block's text is also saved once as a `summary` memory, written by code.
- The model runs with adaptive thinking at medium effort, server-side compaction (beta
  `compact-2026-01-12`) and server-side fallbacks (`fallbacks: "default"`).
- The code never writes Scout's words. The model decides whether and what to say, and silence is
  allowed.

Decision: the loop is our own, not the SDK tool runner. The runner hides the history, fixes the
tool list when it starts, cannot take a `say` in the middle of a turn, and ends silently on
`pause_turn`.

## Outbox and replay

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%
flowchart LR
    N[notify] --> O[outbox per body id]
    O -->|body online| W[connection queue]
    O -->|body offline| K[kept for replay]
    H[hello with last_seq] --> O
    O -->|backlog| W
    W --> S[websocket]
```

- Every notification gets the next `seq` in each body's outbox, online or not.
- The outbox keeps the last 500 notifications or 24 hours, whichever is smaller. It lives in
  memory, so a brain restart means `resync`.
- On `hello` with `last_seq`, the brain sends the `hello` result first, then the missed
  notifications in order, with nothing else in between.
- If something was dropped, or `last_seq` is ahead of the brain, the result says `resync: true`
  and nothing is replayed. Replaying live asks and turns is not built yet.
- Writes go through one queue per connection. `send` never waits and never raises, so one slow
  body cannot stop the others.

## The desktop body

The desktop app (`bodies/desktop`) is a body of this brain. It no longer runs the TypeScript engine.

- Start the brain first (`cd brain && uv run brain`), then the desktop (`pnpm dev:desktop`). The
  desktop dials `TAGALONG_BRAIN_ADDR` (default `127.0.0.1:47321`, the same variable the brain
  listens on) and retries every 2 s, so either order works.
- It sends `hello` declaring the window body tools `list_windows`, `read_window_text` and
  `look_at_window` (see [desktop.md](desktop.md)); the brain offers them to the model as `desktop__<tool>`.
  An ask is a `say` with the text, the screenshot as an image part
  and `context.window`; interrupt is `cancel`.
- With the brain down, the bubble shows "Scout's brain is not running." A brain restart ends the
  open turn as failed; the next ask works without restarting the app.
- The brain's model, key and budget are set in the brain's `.env`. The desktop keeps its own local
  settings (hotkeys, listening, rolling memory).
- Pets, Welcome, the launch greeting, keep-an-eye, wellbeing, the pointer overlay and the separate
  Settings window are not wired to the brain yet. See [desktop.md](desktop.md#the-brain-in-the-main-process).

## Toolbox

`Toolbox` (`toolbox.py`) is the one place tools come from. A `Session` builds it from two sources:
`BrainSource` (remember, recall, forget) and `BodySource` (every online body's declared tools).

- **Per step.** The model's tool list is rebuilt at every step, so a body that connects or leaves
  between steps changes what Scout may call. A tool whose body is offline is never offered.
- **Names.** Body tools reach the model as `<body id>__<tool>`; the body sees its plain name in
  `use`. A full name over 64 characters is dropped and logged.
- **Gate.** A call whose name matches a tool the caller may use runs. A match the caller may not
  use (the tool's audience) is reported as an unknown tool. Otherwise the not-found step runs: a
  name that belongs to an offline body is reported as body offline, anything else as an unknown
  tool. Each failure becomes an `is_error` tool result worded with the reason.
- **Gate step 3: ask.** A call from Scout to a tool whose mode is `ask` waits for a person (see
  [Permissions and asks](#permissions-and-asks)). A call from Home skips this step. A tool never
  runs without passing the gate.
- **Body calls.** `use` waits at most 30 s. On timeout or when the turn is cancelled the brain
  sends the body `cancel {call}`. If the body disconnects mid-call the result says it went
  offline. Response frames from a body are resolved in the read loop by `Bodies.resolve`.
- **Results.** Parts a body returns are size-checked and turned into model blocks; a bad or
  oversized result is an error result.

## Permissions and asks

Every tool has a mode, `ask` or `auto`. `Toolbox.mode(spec)` picks it in this order: a tool that
asks for itself (below) is `auto`; then locked is `ask`; then the user's saved choice; then the
tool's own default; then the effect.

| Tool                                          | Default mode            |
| --------------------------------------------- | ----------------------- |
| Reads (`effect: "read"`), such as `list_jobs` | `auto`                  |
| Changes (`effect: "change"`)                  | `ask`                   |
| Memory tools (`remember`, `forget`)           | `auto`                  |
| Expert tools `tell_expert` and `stop_job`     | `auto`                  |
| `hand_off` (asks itself, see below)           | `auto`, no gate ask     |
| A body tool that does not declare effect      | `ask`                   |
| Locked (`confirm: true` from the body)        | `ask`, and never `auto` |

The user's saved choices live in the `permissions` table in `tagalong.db`:

| Column | Holds                            |
| ------ | -------------------------------- |
| `tool` | The full tool name (primary key) |
| `mode` | `ask` or `auto`                  |

No row means the tool's default applies. `Toolbox.set_mode` refuses `auto` on a locked tool.

A tool whose `ToolSpec` sets `self_asks` runs its own ask with the user, so the gate opens none:
its mode is always `auto` and `Toolbox.set_mode` refuses any change ("<name> asks for itself.").
`list_permissions` rows carry `self_asks` next to `locked`; `locked` stays false for it.

Expert jobs (Claude Code hand-offs) live in the `jobs` table of the same file: id, agent, task, folder, mode, state (`running`, `done`, `error`, `stopped`), reason, progress, result (capped at 20,000 characters), session id, a `reported` flag and start and end times. Rows still `running` at brain start become `stopped` with reason `brain restarted`.
When a job ends, Scout is woken to report it (see [Jobs and tools](#jobs-and-tools)).

An ask is a `confirm` ask (see [protocol/README.md](../protocol/README.md#asks-and-confirm)):

- **Options.** `["allow", "always", "deny"]`, or `["allow", "deny"]` for a locked tool. `always`
  allows this call and saves `auto` for the tool.
- **Text.** The words Scout wrote just before the tool call. The soul tells Scout so: "When you
  call a tool that changes something, the words you write just before it are what the user sees
  when asked to approve it, so say what you are about to do."
- **Answering.** Any online body can send `answer {ask, option}`. The first answer wins: the brain
  closes the ask for every body (`reason: "answered"`, with `by`), and later answers get
  `not_found`. An option the ask did not offer gets `invalid_params` and the ask stays open.
- **Deny.** The tool does not run. Scout is told "The user said no to <tool>."
- **No answer.** After 5 minutes the ask closes with `reason: "timeout"` and the call fails with a
  timeout error.
- **Nobody online.** No ask is opened. The tool does not run and Scout is told "Nobody was there
  to ask, so <tool> was not run."
- **Turn cancelled.** An open ask closes with `reason: "cancelled"` and nothing is left behind.
- **Reconnect.** Asks live in memory only. A body that joins with no `last_seq`, or that is told
  `resync`, is sent every ask still open again, with fresh `seq` numbers. A body that reconnects
  without `resync` gets the ask once, from its backlog.
- **Asks without a turn.** `Asks.open(text=, options=, tool=, input=, timeout=, free_text=, ask_id=)`
  is for work with no Scout turn (expert jobs). It sends a plain ask: no `turn`, no `confirm`, any
  option names (for example `allow-once`, `reject`). It waits until closed; there is no default
  timeout (pass `timeout` to get one). It returns `Answer(option, text)`; with nobody online it
  returns `Answer(None, None)` at once and opens nothing. With `free_text=True` an answer whose
  option is not listed is accepted when it carries non-empty `text` (the user typed their own
  answer). `cancel_all(ask_ids)` closes the named asks with `reason: "cancelled"` and their waiters
  get a `cancelled` error. `answer {ask, option, text}` now passes `text` through to the ask; the
  closed frame is unchanged.

## Home tools

Home is a screen in a body. It reads and changes the brain through the same toolbox Scout uses,
so there is one gate and no second path.

- **Hello.** The `hello` result's `tools` lists every tool whose audience includes `home`
  (`Session.home_tools()`): name, description, `input_schema` and `effect` only. Audience, mode and
  locked never reach the wire. Home tools are never offered to the model.
- **Call.** `call {tool, input}` runs `Toolbox.run(..., caller="home")`, which skips the ask. It
  runs in its own task, so a slow call never blocks the read loop that delivers `use` responses
  and `answer`s. The result is `{output: [{type: "text", text: <JSON>}]}`. A `call` sent as a
  notification (no id) is ignored; a closed connection cancels its running calls.
- **Errors.** A tool Home may not use, or that does not exist, is `unknown_tool`. Bad params
  (including a `set_permission` without `tool` or `mode`) are `invalid_params`. A tool that fails
  (for example `forget` with an id that does not exist) is `tool_failed` with the message. Any
  `RpcError` a tool raises keeps its code (for example `set_permission` of a locked tool to
  `auto` is `invalid_params`).
- **Changed.** `remember` and `forget` send `changed {what: "memory"}`; `set_permission` sends
  `changed {what: "permissions"}`. Every body gets it, so Home refetches.

| Tool               | Input                        | Result text (JSON)                                                                                                          |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `list_memories`    | `{}`                         | `{"memories": [{"id", "kind", "text", "cadence", "at"}]}`, newest first, at most 200                                        |
| `forget`           | `{"id": int}`                | a plain sentence, `forgot <kind> #<id>: <text>` (Scout may call it too)                                                     |
| `spend_today`      | `{}`                         | `{"spent_usd": float, "limit_usd": float}`                                                                                  |
| `list_permissions` | `{}`                         | `{"tools": [{"name", "description", "effect", "mode", "locked", "self_asks", "online"}]}`, sorted by name, Scout tools only |
| `set_permission`   | `{"tool": str, "mode": str}` | `{"tool", "mode"}`; `mode` is `ask` or `auto`                                                                               |
| `list_jobs`        | `{}`                         | `{"jobs": [job rows]}`, last 20, newest first (see [Experts](#experts)); Scout may call it too                              |
| `stop_job`         | `{"job": str}`               | `{"job", "stopping": true}`; a job that is not running is `invalid_params` (Scout may call it too)                          |

`list_permissions` includes the last-declared tools of bodies that are offline (`online: false`).

The app calls below are Home-only. A refusal is `invalid_params` with a plain line. Each change
sends `changed {what: "apps"}`, as does every status change of an app. Home's Connections page calls
all five (see [connected-apps.md](connected-apps.md#homes-connections-page)).

| Tool              | Input                                                                                            | Result text (JSON)                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `list_apps`       | `{}`                                                                                             | `{"apps": [{"id", "name", "transport", "auth", "enabled", "status", "error", "tools": [{"name", "effect", "locked"}]}]}` |
| `add_app`         | `{"name", "transport": "stdio"\|"http", "command"?, "args"?, "env"?, "url"?, "auth"?, "token"?}` | `{"id"}`; connects at once. `token` (only with `auth: "token"`) goes to `app-tokens.json`, never the row                 |
| `set_app_enabled` | `{"id", "enabled": bool}`                                                                        | `{"id", "enabled"}`                                                                                                      |
| `remove_app`      | `{"id"}`                                                                                         | `{"id", "removed": true}`; stops the app, deletes its row and token                                                      |
| `restart_app`     | `{"id"}`                                                                                         | `{"id", "restarting": true}`                                                                                             |

An unknown id is refused with `There is no app called <id>.`

## Connected apps

`apps.py` and `app_tools.py` let Scout use MCP servers the user adds. See
[connected-apps.md](connected-apps.md) for the user's view; this is the brain's side.

- **`Apps`** keeps one long-lived task per enabled app. `main` calls `apps.start()` once the server
  is up (it returns at once; a slow or hanging app never delays boot) and `apps.shutdown()` after
  the experts stop and before memory closes.
- **`AppSource`** is the toolbox's third source. A connected app's tools appear as `<app>__<tool>`
  (Scout only, never Home). Reads run at once, changes ask, and a tool is locked (asks every time,
  never `auto`) when its hints say destructive or its name has a risky word (`send`, `delete`,
  `remove`, `destroy`, `trash`, `pay`, `charge`). An app that is not connected is offline.
  Answers are capped at 8,000 characters and fenced as `<data kind="app" app="<id>">`.
- **Rows** are in the `apps` table of `tagalong.db` (id, name, transport, config, auth, enabled).
  `${VAR}` references in env stay as written and are filled from the brain's environment at connect.
- **`app-tokens.json`** in the data directory holds pasted tokens by app id (kept owner-only where
  the platform allows). A token is never in a row, a tool list or an error line.

## Experts

Scout can hand a task to Claude Code, which works in a folder as a job. `experts.py` runs it,
`jobs.py` manages the jobs, and four tools put it in Scout's and Home's hands.

### Runner

`experts.py` holds `ExpertRun`, the one object that drives Claude Code in a folder over the Agent
Client Protocol. `Jobs` creates one per job. `start(folder)` spawns the adapter, runs
`initialize` (advertising `elicitation.form` so questions work) and `session/new`, and returns
the modes. `begin(mode, task)` sets the mode and sends the first prompt without waiting. `note(text)`
queues a follow-up prompt for after the current turn and returns `False` once the run has ended.
`stop()` sends `session/cancel` and ends the process; `close()` ends it too. All callbacks are
async: `on_permission` returns an option id (`None` sends a cancelled outcome), `on_question`
returns the answer fields (`None` cancels), `on_progress` gets the latest assistant message and
`on_end(state, reason, result)` ends the run with `done`, `error` (including `timeout` and an
adapter crash) or `stopped`.

Install the adapter once: `npm install -g @agentclientprotocol/claude-agent-acp` (Node 22 or newer).
A missing command is reported with that step. `TAGALONG_EXPERT_CMD` swaps the command and
`TAGALONG_EXPERT_TIMEOUT_S` sets the run limit. The command is split like a shell on Linux and
macOS; on Windows backslashes are kept, so `C:\Users\me\AppData\Roaming\npm\claude-agent-acp.cmd`
works as written (quote it if it has spaces). A question's `QuestionField` carries the key,
title, the question's own text (`description`), the option labels and `multi` (a multi-select
answers with a list of labels). The child gets the brain's environment without
`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, so Claude Code bills the user's own login, not
the key Scout uses. The process is closed by closing its stdin; if it stays alive it is killed with
its children (`taskkill /T /F` on Windows; on Linux and macOS only the adapter process is
killed, and its children exit when their stdin closes). Start and the mode change are bounded by a 60 s
startup limit (an adapter that never answers is killed and reported). `stop()` and `close()` are
safe from any state, including from inside `on_end`; teardown is shared, so `on_end` fires once,
after the process is gone. A stop answers any pending permission or question as cancelled.

Claude Code runs on the user's own login. It must be logged in, or the first hand-off fails with
the adapter's own message (for example that auth is required).

### Jobs and tools

`Jobs` (`jobs.py`) owns the running `ExpertRun`s and the rows of the `jobs` table (columns under
[Permissions and asks](#permissions-and-asks)). `Session` builds it with the `ExpertRun` factory
that `main.py` configures (`TAGALONG_EXPERT_CMD`, `TAGALONG_EXPERT_TIMEOUT_S`) and calls
`startup()`, which turns rows left `running` into `stopped` with reason `brain restarted`.

**Wake and the finish turn.** `Session.wake(event_text)` is the entry point for events that are not
the user talking. It queues the event; when no turn runs, it starts one turn per event, in order,
through the same path as `say` (same budget, step cap and turn notifications). The turn goes to the
body Scout last talked to if it is online, else any online body; with none online the event waits
until a body connects. The event is fenced as `<data kind="job">`, so its text is data, not
instructions.

When a job ends, the session wakes Scout with a note of facts only (id, task, folder, state, reason,
and the result cut at 4,000 characters with `[trimmed]`). `reported` is set once that turn has started (a failed start leaves it unreported). At
brain start every finished unreported job (including those just stopped) is queued again. Scout's
prompt says a job note is an event, not a request; the model decides whether to speak, and may say
nothing.

| Tool          | Audience    | Effect | Gate                      | Does                                                                         |
| ------------- | ----------- | ------ | ------------------------- | ---------------------------------------------------------------------------- |
| `hand_off`    | scout       | change | asks itself (`self_asks`) | `{task, folder}`. Returns `job <id> started`, or the plain reason it did not |
| `tell_expert` | scout       | change | `auto`                    | `{job, note}`. Queues a follow-up prompt for a running job                   |
| `list_jobs`   | scout, home | read   | `auto`                    | `{"jobs": [...]}`, the last 20 rows newest first, with the latest progress   |
| `stop_job`    | scout, home | change | `auto`                    | `{job}`. Stops a running job; Home gets `{"job", "stopping": true}`          |

Refusals (`JobError`) are plain sentences: for `hand_off` and `tell_expert` they are the tool's
result line; for `stop_job` they are an `invalid_params` `RpcError` with the same words, so Home
shows them as Scout does.

- **Hand-off ask.** `hand_off` needs an absolute folder that exists ("no folder at <path>"
  otherwise). It starts the adapter and opens an ask whose text is the task, with the folder as
  its input and the modes the adapter reports plus `cancel` as options. A mode answer starts the
  job. `cancel`, no answer in 5 minutes, or nobody online closes the adapter and returns "not
  started". The tool asks for itself, so the gate adds no allow or deny ask, and Home cannot
  change its mode.
- **Relayed asks.** Claude Code's permission requests and questions become turn-less asks
  (`Asks.open`) tied to the job and kept open as long as it lives. A stopped or finished job
  closes its open asks with `cancelled`. Each answer sends `changed {what: "jobs"}`.
- **Limits.** At most 2 jobs run at once (a hand-off waiting on its ask holds a slot); a third
  fails naming the running jobs. A result is capped at 20,000 characters and progress keeps its
  last 2,000 (it is a running tail). `list_jobs` trims each row for Scout's context: a result to
  its first 1,000 characters and progress to its last 1,000, a trimmed end marked with `…`. The
  run limit is `TAGALONG_EXPERT_TIMEOUT_S` (30 minutes by default).
- **Changed.** Every state change sends `changed {what: "jobs"}`. Progress text is throttled to
  one per 2 seconds, with no trailing notify, so a body may show slightly stale progress until
  the next change.
- **Restart.** Jobs do not resume. A brain restart marks running jobs `stopped`.
- **Shutdown.** On exit `main.py` calls `Jobs.shutdown()` before closing memory: it stops every
  running job (rows become `stopped`, adapters end) and ignores a run that fails to stop. Shutdown
  sends no report: those jobs stay unreported and are told about at the next start.

## Not built yet

| Row   | Brings                                         |
| ----- | ---------------------------------------------- |
| Later | Live-state replay of open turns after `resync` |

## Tests

`cd brain && uv run pytest`. `tests/test_server.py` runs a real server on a free port with the
`websockets` client. The model is faked in tests, so none call Anthropic.
