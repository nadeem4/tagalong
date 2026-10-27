# Experts (row 8): design

Status: approved by the user 2026-10-27 (runner switched to ACP after approval, at the user's choice). Calls marked "(my call)" are mine and open to change.

## Intent

Scout is the companion; Claude Code does the heavy work, the same way the user works with Claude Code today, on their own subscription. When the user asks for something that needs real work in a repo ("fix the failing test in tagalong"), Scout hands it to Claude Code, which runs in the background on the brain's machine. Claude Code can do whatever its permission mode allows. Whenever it needs a yes or has a question, the user gets it through Scout and Claude Code carries on with the answer. When the job ends, Scout tells the user what happened. One interface for every project.

## Goals

- Scout hands a task to Claude Code in a folder the user named, after the user confirms the folder and picks the permission mode (user).
- Every permission prompt and every question Claude Code raises reaches the user as an ask; the answer goes back to Claude Code (user).
- Claude Code runs on the user's existing Claude login, not a separate API key (user).
- The brain drives agents through the Agent Client Protocol (ACP), so Codex, Gemini or Hermes can be added later as configuration (user chose ACP).
- The run is a job: it has a state, is saved, and can be stopped.
- Scout can add a note to a running job ("also update the docs").
- When a job ends, the brain starts a turn of its own, so Scout reports back without the user asking.
- Home lists jobs and can stop one, through the existing `call`. No new contract messages.

## Non-goals (this row)

- Agents other than Claude Code. The runner speaks ACP, so they come later, but this row configures and tests only Claude Code.
- Catalog experts (researcher, trip planner); background Scout conversations (old `work_on_it`; the scheduler, row 10, covers that).
- Resuming a job after a brain restart. A job that was running when the brain stopped is marked stopped.
- Two-step hand-offs (`then`), project finder, pick-up card.
- Secret-file rules, spend caps: row 11 (guardrails). MCP apps: row 9.
- Omnigent: looked at, not used. It is a whole platform with its own UI; Tagalong stays the one interface (user).

## Anti-goals

- Scout guessing the folder (user). If the user did not name it, Scout asks.
- Collecting, storing or passing on Claude login tokens. The adapter runs the user's own Claude Code login on the user's own machine; the brain never touches credentials.
- Rebuilding what Claude Code already does. The brain passes the task through and relays.
- Canned Scout lines. The finish turn gives the model the result; the model decides what to say, or says nothing.
- New contract messages. Everything rides on tools, asks, `changed` and brain-started turns.

## Shape

### The runner (`brain/src/brain/experts.py`)

The brain is an ACP client, using the Python `agent-client-protocol` package. It spawns the agent as a subprocess and talks JSON-RPC over its stdio. The agent command comes from config: `TAGALONG_EXPERT_CMD`, default the Claude adapter `claude-agent-acp` (npm package `@agentclientprotocol/claude-agent-acp`, a Node package that runs Claude Code; verified in Task 1 below) (my call).

Per job:

1. Spawn the adapter, `initialize`, then `session/new` with `cwd` = the job's folder and no MCP servers.
2. The new session reports its available modes; the hand-off ask offers them (below). Set the picked mode on the session.
3. `session/prompt` with the task. `session/update` notifications are the job's progress; the brain keeps the latest text for `list_jobs` and does not forward every update.
4. A `tell_expert` note while a prompt turn is running is queued and sent as the next `session/prompt` in the same session when the turn ends (ACP runs one prompt turn at a time) (my call).
5. The job ends when a prompt turn ends and no note is queued: the last agent message is the job's result. The brain then closes the adapter.
6. Stop sends `session/cancel`, then ends the process tree.
7. Timeout: 30 minutes per job, then stop with state `error`, reason `timeout`.

The runner sits behind one small class so a fake ACP agent replaces it in tests.

**Task 1 checks** (done 2026-10-27, results in "Task 1 findings" below): the Python package's client API names; the adapter's package name, install and launch command on Windows; that it uses the user's existing Claude Code login when no `ANTHROPIC_API_KEY` is set; how modes are listed and set; how permission requests and Claude's questions reach the client. Everything below was run against the real adapter; where it differed from what this doc first assumed, the doc was changed in the same commit.

### Hand-off: folder and mode (user)

`hand_off { task, folder }`:

1. The tool description tells the model to use the folder the user named, and to ask the user if they did not name one.
2. The handler resolves `folder` to an absolute path. It must exist and be a directory, otherwise the tool fails with a plain message ("no folder at C:\...") and the model asks the user again.
3. The handler starts the adapter and session (steps 1-2 above), then opens an ask: `text` is the task, the ask shows the absolute folder, and `options` are the session's mode names plus `cancel`. Bodies already show any options as buttons.
4. A mode answer sets the mode and sends the task. `cancel`, deny or timeout closes the adapter and returns "not started" to the model.

The tool asks every time on its own, so it is `locked` at the gate with `auto` mode (my call): no second allow/deny ask, and Home cannot switch it to "always".

### Relaying Claude Code's prompts (user)

- **Permission request** (`session/request_permission`): the brain opens an ask with `tool` set to `claude_code:<tool title>`, `input` the tool call's details, empty `text` (bodies show tool and input, as for any confirm ask), and `options` the option names the request carries (for example allow once, allow always, reject). The user's pick goes back as the selected option. The adapter decides what "always" means; the brain saves nothing.
- **Question** (Claude's `AskUserQuestion` tool, which reaches the client as an ACP form elicitation, `elicitation/create`; the client must advertise `elicitation.form` or Claude never gets the tool): one ask per question, `text` the question, `options` its choices; the user's free `text` is accepted too. The answer goes back as the elicitation's accept content (exact keys in the findings).
- Relayed asks have no `turn` (the field is optional) and stay open as long as the job lives; the job's timeout bounds them (my call). A job stopped or timed out closes its open asks with `cancelled`, and answers a pending permission request as cancelled.
- After the user answers, `changed: jobs` is sent so Home shows the job moving again.

`asks.py` gains a turn-less ask with custom options.

### Jobs

A job row lives in the existing SQLite store (`memory.py`, through `_migrate`), table `jobs`:

`id, agent, task, folder, mode, state, reason, progress, result, session_id, reported, started_at, ended_at`

States: `running`, `done`, `error`, `stopped`. No queue: at most 2 jobs run at once (my call); a third `hand_off` fails with a plain message naming the running jobs. On brain start, any row still `running` becomes `stopped`, reason `brain restarted`.

Every state change, note and answered relay sends `changed` with `what: "jobs"`.

### Scout's tools

| Tool          | Audience    | Effect | Gate                      | Does                                                                                      |
| ------------- | ----------- | ------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| `hand_off`    | scout       | change | locked auto (asks itself) | `{ task, folder }`. Confirms folder and mode, starts a job, returns its id and "started". |
| `tell_expert` | scout       | change | auto                      | `{ job, note }`. Queues a note for a running job.                                         |
| `list_jobs`   | scout, home | read   | auto                      | Recent jobs (last 20), newest first, with latest progress.                                |
| `stop_job`    | scout, home | change | auto                      | `{ job }`. Stops a running job.                                                           |

### Report back: the finish turn

When a job ends, the brain starts a turn of its own: `Session.wake(event)`. It waits until no turn is running, then runs a turn whose input is a short event note (job id, task, folder, state, result text trimmed to a limit). Per Rule 3 it goes to the body the user last talked to if online, else any online body, else it waits for one.

- The session remembers the body of the last `say`; the wake turn carries that body id, so its asks and body tools route as a user turn's do (my call).
- Pending wakes queue in memory behind any running turn. The job's `reported` flag is set when its wake turn runs; on brain start, finished jobs with `reported` false are queued again (my call).
- A wake turn has the same budget and step cap as a user turn. It can call `hand_off` again, which still asks the user, and the 2-job cap bounds it.

`wake` is the first brain-started entry point. Row 10 (scheduler) reuses it; this row builds only what the finish event needs.

### Home

Home gets `list_jobs` and `stop_job` through `hello` and `call`, like 7c. Desktop work: a Jobs panel in Home that lists jobs (task, folder, mode, state, progress, time, result on expand) with Stop on running ones, refetching on `changed: jobs`. The desktop's ask card already shows any options as buttons; 8b checks the hand-off ask (mode buttons, folder visible) and the relayed asks look right, and fixes only what does not. Old hand-off cards and the pick-up card are not ported.

## Task 1 findings (verified 2026-10-27, Windows 11, Node 22.23, Python 3.13)

Captured with a scratch client against the real adapter on the user's Claude Code subscription. Frame shapes are saved in `brain/tests/fixtures/acp/` (`handshake.json`, `permission.json`, `question.json`, `cancel.json`; paths redacted, usage, auth and command-list frames dropped). The fake agent in Task 2 replays these shapes.

**Login (the gate): passes.** With `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` absent from the adapter's environment, the adapter ran prompts on the existing Claude Code login (no `authMethods`, no login step; `initialize` returns `authMethods: []`). With `ANTHROPIC_API_KEY=<bogus>` in its environment the key wins: the adapter reports auth kind `api_key`, the turn answers with an invalid-key message and `session/prompt` fails with JSON-RPC error -32000 "Authentication required". So a stray key in the brain's environment would break or bill the wrong account; the env strip is justified.

**Python package.** PyPI `agent-client-protocol` 0.12.1 (import `acp`; needs Python >=3.10 and pydantic >=2.7, both compatible with `brain/`).

- Spawn: `acp.spawn_agent_process(client, command, *args, env=None, cwd=None, use_unstable_protocol=True, observers=[fn])`, an async context manager yielding `(conn, process)`. `conn` is a `ClientSideConnection`, `process` an `asyncio.subprocess.Process`. `observers` receive every raw JSON-RPC frame (`StreamEvent.direction`, `.message`): the hook for logging and for fixtures.
- `use_unstable_protocol=True` is required, otherwise the library warns and the agent's `elicitation/create` request fails (it is an unstable method in schema 1.19).
- The child env is NOT inherited whole: `env` is merged over a trimmed default (Windows: `APPDATA, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH, PATHEXT, PROCESSOR_ARCHITECTURE, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE`). That already drops `ANTHROPIC_*` variables (a user may have `ANTHROPIC_BASE_URL` set in their shell; it is dropped too). The runner passes an explicit `env` and never forwards the two key variables.
- Handshake and calls (all keyword arguments): `await conn.initialize(protocol_version=acp.PROTOCOL_VERSION, client_capabilities=ClientCapabilities(elicitation=ElicitationCapabilities(form=ElicitationFormCapabilities())), client_info=Implementation(name=..., version=...))`; `await conn.new_session(cwd=str, mcp_servers=[])` returns `session_id` and `modes`; `await conn.set_session_mode(session_id=..., mode_id=...)`; `await conn.prompt(session_id=..., prompt=[acp.text_block(text)])` returns `PromptResponse(stop_reason=...)`; `await conn.cancel(session_id=...)` is a notification. Schema types are in `acp.schema`.
- Client interface (a plain object, no base class needed): `on_connect(conn)`, `request_permission(session_id, tool_call, options, **kw)`, `session_update(session_id, update, **kw)`, `create_elicitation(message, mode, **kw)`, plus `ext_method(method, params)` and `ext_notification(method, params)`, which the adapter calls for `_auth/status_update` (implement them as no-ops).
  - `request_permission` returns `RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", option_id=...))` or `RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))`. `tool_call` has `title`, `kind` (`edit`, `execute`, `other`, ...), `raw_input` (the tool's input dict), `content`, `tool_call_id`. Each `PermissionOption` has `option_id`, `name`, `kind` (`allow_once`, `allow_always`, `reject_once`, `reject_always`).
  - `session_update`: `update.session_update` is the kind string. Assistant text arrives as `agent_message_chunk` with `update.content.text` (many small chunks per message; they share a `message_id`). Others seen: `tool_call`, `tool_call_update` (`status` pending/completed/failed, `raw_input`, `raw_output`, `title`), `available_commands_update`, `session_info_update`, `usage_update`. "Latest progress" and "last agent message" come from joining `agent_message_chunk` text per `message_id`; the runner ignores the rest, or uses a `tool_call` `title` as progress.
  - `create_elicitation`: the second argument `mode` is the whole request object (`.requested_schema`, `.session_id`, `.tool_call_id`); `message` is the question text. Return `AcceptElicitationResponse(action="accept", content={...})`, `DeclineElicitationResponse(action="decline")` or `CancelElicitationResponse(action="cancel")`.

**Adapter.** npm `@agentclientprotocol/claude-agent-acp` 0.98.0 (bin `claude-agent-acp`; needs Node >=22; depends on `@anthropic-ai/claude-agent-sdk`, which brings its own native `claude.exe`). The unscoped name `claude-agent-acp` does not exist on npm; `@zed-industries/claude-code-acp` (0.16.2) is the old name. Install: `npm install -g @agentclientprotocol/claude-agent-acp`. Launch on Windows: the npm shim is `claude-agent-acp.cmd`; `asyncio.create_subprocess_exec` runs it directly given its full path, no shell (bare `claude-agent-acp` without extension would not resolve, so use `shutil.which("claude-agent-acp")`, which returns the `.cmd`). Running `node <pkg>/dist/index.js` directly also works and avoids the extra `cmd.exe` layer. Both were tested. Startup: `session/new` took about 4.4 s (the adapter's Claude Code loads the user's settings, plugins and MCP servers; a trivial prompt then took about 4 s). The adapter therefore behaves like the user's own Claude Code: their hooks, skills and MCP servers apply (an unrequested `.remember` file appeared in the job folder during the spike, presumably from one of the user's plugins).

**Modes.** `session/new` returns `modes.currentModeId` (`default`) and `modes.availableModes`: `default` "Manual" (always ask before changes), `acceptEdits` "Accept edits", `plan` "Plan", `auto` "Auto" (Claude handles permission decisions), `bypassPermissions` "Bypass permissions" (accepts all permissions). `set_session_mode(session_id, mode_id)` returns an empty response; an unknown id raises `RequestError` ("Internal error"). Recommendation (my call, open): the hand-off ask offers the modes the session reports, minus `bypassPermissions` and `auto`, until row 11 (guardrails) decides how those are gated; the ids to match are `default`, `acceptEdits`, `plan`.

**Permission request** (default mode, Write tool). Agent to client `session/request_permission` with `params.toolCall` (`toolCallId`, `name` "Write", `title` "Write hello.txt", `kind` "edit", `rawInput` {file_path, content}, `content` a diff, `locations`) and `params.options`: `allow-once` "Yes" (`allow_once`), `allow-with-updates` "Yes, allow all edits during this session" (`allow_always`), `reject` "No" (`reject_once`). A Bash call offers only `allow-once` and `reject`. So option ids vary by tool: map by `kind`, and show `name`. Reply: `{"outcome":{"outcome":"selected","optionId":"allow-once"}}` or `{"outcome":{"outcome":"cancelled"}}`. A cancelled reply aborts that tool call (`tool_call_update` status `failed`) but the turn carries on and ends `end_turn` with the model explaining; to stop the job, send `session/cancel`.

**Questions.** Claude's `AskUserQuestion` tool is enabled only when the client advertises `elicitation.form` in `initialize`. Without it the tool is disabled and Claude asks in plain text, ending the turn (nothing reaches the client as a question). With it, the question arrives as agent to client `elicitation/create`: `params` = `{mode:"form", sessionId, toolCallId, message:<the question>, requestedSchema:{type:"object", properties:{question_0:{type:"string", title:<header>, oneOf:[{const:<label>, title:<label>, description}, ...]}, question_0_custom:{type:"string", title:"Other"}}}}`. Several questions give `question_0`, `question_1`, ... each with its own `_custom`; a multi-select question is `{type:"array", items:{anyOf:[...]}}`. Answer: `{"action":"accept","content":{"question_0":"Red"}}` picks an option (the value is the option's `const`, its label); `{"action":"accept","content":{"question_0_custom":"teal"}}` is a free-text answer (verified: Claude answered "Teal."); both keys together mean the pick plus a note. `{"action":"decline"}` tells Claude the user skipped; `{"action":"cancel"}` aborts the tool call. The ask for the user: `text` = `message` (or each property's `title`/question for several), `options` = the `oneOf` labels, free text allowed.

**Cancel and end of turn.** `session/prompt` resolves with `stopReason`: `end_turn` (normal), `cancelled` (after `session/cancel`; seen mid-Bash: the running tool call goes `failed`, then the prompt returns `cancelled`). The schema also allows `max_tokens`, `max_turn_requests`, `refusal`. Failures surface as a JSON-RPC error on `session/prompt` (`RequestError`, for example -32000 "Authentication required"). The adapter advertises `_meta.claudeCode.promptQueueing: true` (a second `session/prompt` while one runs is queued by the adapter); not exercised, so the design keeps its own note queue.

**Process lifetime on Windows.** The tree is `[cmd.exe if launched via the .cmd shim] -> node -> claude.exe -> (the user's MCP server processes, bash for tool calls)`. When stdin closes, the adapter exits on its own: idle and mid-turn, exit code 0 within 0.1 s, and its `claude.exe` child was gone afterwards. `spawn_agent_process` does this on exit (close stdin, wait 2 s, then `terminate()`, then `kill()`), but on Windows those only hit the root process. Hard stop: `taskkill /PID <pid> /T /F` killed the whole tree in 0.5 s (exit code 1). So the runner stops a job as: `session/cancel`, wait briefly for `cancelled`, leave the context (stdin close), and if the process is still alive after a few seconds run `taskkill /PID <pid> /T /F`.

## Slices

| Slice | PR      | Contents                                                                                                                                                                                                                                    |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8a    | brain   | Task 1 checks; ACP runner (with fake agent), hand-off ask, relayed asks, `jobs` table, the four tools, `changed: jobs`, restart cleanup, `Session.wake` and the finish turn, docs/brain.md section and setup notes (installing the adapter) |
| 8b    | desktop | Home Jobs panel through `call`, refetch on `changed: jobs`, hand-off and relayed asks shown right, e2e on the fake brain, docs/desktop.md and feature-test-guide                                                                            |

If 8a runs past ~1,000 lines, split the wake turn into 8a2.

## Decided

- Claude Code runs where the brain runs and edits repos on that machine (user, Decisions 2026-10-23).
- No new contract messages (user, Decisions 2026-10-24).
- Drive agents through ACP; Claude Code through its ACP adapter, on the user's own login (user).
- Omnigent not used (user).
- The user picks the mode on each hand-off; Claude Code's permission prompts and questions are relayed and answered back (user).
- The user names and confirms the folder; Scout never guesses it (user).
- An expert finishing starts a brain turn to the last-talked body (user, Plan Rule 3).
- Claude Code only this row; no catalog experts, no background Scout jobs (my call, from "don't replicate experts").
- `hand_off` locked so every hand-off asks; notes queue as follow-up prompts (my call).
- At most 2 running jobs, no queue; 30-minute timeout; last 20 in `list_jobs`; no resume after restart (my call).

## Left to the builder

- Exact ACP library and adapter names and shapes, verified in task 1.
- How long the result text in the finish note may be before trimming.
- Panel layout within DESIGN.md's rules.
