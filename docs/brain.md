# The Python brain

The brain is the Python side of contract v1 ([protocol/README.md](../protocol/README.md)). It is
being built row by row and replaces `packages/core`. Today bodies can connect, declare their tools,
catch up on missed notifications, and talk to Scout: `say` starts a turn and the reply streams
back. Scout remembers through the `remember`, `recall` and `forget` tools, kept in `tagalong.db`
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

| Variable                    | Default           | Meaning                                                            |
| --------------------------- | ----------------- | ------------------------------------------------------------------ |
| `TAGALONG_BRAIN_ADDR`       | `127.0.0.1:47321` | `host:port` to listen on. Port `0` picks a free port               |
| `TAGALONG_HOME`             | `~/.tagalong`     | Data folder. Holds `session`, `budget.json`, `tagalong.db`, `.env` |
| `TAGALONG_MODEL`            | `claude-opus-5-5` | Model Scout thinks with                                            |
| `TAGALONG_DAILY_BUDGET_USD` | `5`               | Most Scout may spend per local day, in USD                         |
| `TAGALONG_STEP_CAP`         | `25`              | Most model calls in one turn                                       |
| `ANTHROPIC_API_KEY`         | none, required    | Anthropic key                                                      |

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

| File                             | What it does                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `brain/src/brain/protocol.py`    | Contract v1 as pydantic types                                                                 |
| `brain/src/brain/config.py`      | Reads the environment and `.env`, keeps the session id                                        |
| `brain/src/brain/guardrails.py`  | The daily budget and its `budget.json` ledger                                                 |
| `brain/src/brain/sessions.py`    | The one conversation: history, the running turn, `say` joins, `cancel`                        |
| `brain/src/brain/mind/resume.py` | Rebuilds a valid history from the saved chat at start                                         |
| `brain/src/brain/memory.py`      | Scout's memory: the kinds table and the SQLite store (`tagalong.db`)                          |
| `brain/src/brain/toolbox.py`     | `Toolbox`: every tool the model or Home may call, from sources (`BrainSource` now); lists scout tools and gates each call |
| `brain/src/brain/tools.py`       | The brain's own tools (`remember`, `recall`, `forget`) as specs and handlers for `BrainSource` |
| `brain/src/brain/mind/soul.md`   | Scout's character, the start of the system prompt                                             |
| `brain/src/brain/mind/prompt.py` | The system prompt (soul, local time, online bodies, "What you know") and `say` content blocks |
| `brain/src/brain/mind/turn.py`   | The thinking loop and the Anthropic streaming call                                            |
| `brain/src/brain/bodies.py`      | Online bodies, their tools, and one outbox per body id                                        |
| `brain/src/brain/server.py`      | The websocket server: parsing, errors, `hello`, `tools`, `say`, `cancel`, the writer          |
| `brain/src/brain/main.py`        | The `uv run brain` entry point                                                                |

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
  ignored. `call` and `answer` answer `method_not_found` until they are built. `event`,
  `progress` and unknown notifications are ignored. An unknown request gets `method_not_found`.
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
  `forget`); a refused or failed call ends as an error result the model reads. No body tools are
  offered to the model yet.
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
  `look_at_window` (see [desktop.md](desktop.md)); the brain does not offer them to the model yet.
  An ask is a `say` with the text, the screenshot as an image part
  and `context.window`; interrupt is `cancel`.
- With the brain down, the bubble shows "Scout's brain is not running." A brain restart ends the
  open turn as failed; the next ask works without restarting the app.
- The brain's model, key and budget are set in the brain's `.env`. The desktop keeps its own local
  settings (hotkeys, listening, rolling memory).
- Pets, Welcome, the launch greeting, keep-an-eye, wellbeing, the pointer overlay and the separate
  Settings window are not wired to the brain yet. See [desktop.md](desktop.md#the-brain-in-the-main-process).

## Not built yet

| Row   | Brings                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7     | Body tools for Scout (`use` plugs into the loop), the brain's tools in the `hello` result, `use` and its `cancel` to bodies, `call`, model tool names `<body>__<tool>`, part size checks as `say` and tools land |
| Later | Live-state replay after `resync`, asks, `answer` and confirm guardrails                                                                                                                                          |

Until then `call` and `answer` answer `method_not_found`.

## Tests

`cd brain && uv run pytest`. `tests/test_server.py` runs a real server on a free port with the
`websockets` client. The model is faked in tests, so none call Anthropic.
