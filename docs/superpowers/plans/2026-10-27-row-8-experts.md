# Row 8 plan: Experts (Claude Code over ACP)

Design: docs/superpowers/specs/2026-10-27-experts-design.md (approved). Read it first. No earlier row-7 plan files exist in the repo (they live in Notion), so this plan sets the format: slice, then tasks, each with files, test-first steps, acceptance and a commit message.

Rules for every task: TDD (write the failing test, see it fail, then code). Tests never need Claude Code, Node or network; they use the fake ACP agent from task 2. Every new file opens with a 2-6 line header that says why. Docs are part of done. No Claude or AI attribution anywhere (no Co-Authored-By, no "Generated with"); repeat this in every sub-agent prompt that commits. Check before each PR: `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; 8b also `pnpm test`, `pnpm typecheck && pnpm lint && pnpm format:check`.

## Slices

The design guessed 8a at about 1,000 lines. Sized honestly it is about 2,200 (runner and fake agent, asks changes, jobs store, gate change, four tools, wake turn, docs), so 8a is three PRs.

| Slice | PR | Contents | Est. changed lines |
|---|---|---|---|
| 8a1 | brain | Task 1 spike; fake ACP agent; ACP runner; turn-less asks with custom options and free text | 850-950 |
| 8a2 | brain | `jobs` table; gate flag for self-asking tools; hand-off ask; relayed asks; four tools; `changed: jobs`; restart cleanup; config and main wiring | 900-1,000 |
| 8a3 | brain | `Session.wake`; finish turn; requeue unreported jobs; docs/brain.md, README, feature-test-guide | 400-500 |
| 8b | desktop | Home Jobs panel via `call`; refetch on `changed: jobs`; hand-off and relayed asks checked; e2e on fake brain; docs | 650-800 |

Order: 8a1 -> 8a2 -> 8a3 -> 8b. 8b may start after 8a2 merges (it only needs `list_jobs` and `stop_job`), in its own worktree.

## Design gaps found while planning (handled in the tasks below)

1. **API key leak into the adapter.** `main.py` exits without `ANTHROPIC_API_KEY`, and `load_env_file` puts it in `os.environ`. The adapter inherits the environment, so Claude Code would bill the API key instead of the user's login. The runner must strip `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`) from the adapter's environment. Task 1 confirms login works with it stripped. (8a1 task 3)
2. **"Locked at the gate with auto mode" does not exist.** `Toolbox.mode` returns `ask` for any `locked` spec, so `hand_off` would raise a second allow/deny ask on top of its own. A new spec flag `self_asks` is needed: the gate skips step 3, Home's switch shows "Asks itself", and `set_permission` refuses it. (8a2 task 2)
3. **`confirm` asks cannot carry custom options.** `AskOpen` rejects `confirm: true` unless options are `allow/deny` or `allow/always/deny`. Relayed Claude Code asks (custom option names) therefore set `tool` and `input` but leave `confirm` unset. Whether the desktop ask card shows tool and input for a non-confirm ask is checked in 8b task 3.
4. **`Asks.answer` drops free text.** `AnswerParams.text` exists in the contract but `server._dispatch` and `Session.answer` never pass it on. Needed for Claude Code questions. (8a1 task 4)
5. **Asks are bound to a turn.** `Asks.permission` takes a `Call`. Job asks have no turn and outlive any turn, so a new `Asks.open` is needed. (8a1 task 4)
6. **The wake turn must run through `run_turn` with a synthetic user message, with no `say` result and no inbox.** `Session.say` creates the turn id and ties to a body id it receives. Wake needs the last-talked body remembered. (8a3)
7. **The Experts page already has an old-engine `ExpertsPanel`** (`bodies/ui/src/home/experts-panel.tsx`, 685 lines, from packages/core). The new Jobs panel goes on the same page, above it. 8b task 2 checks what the old panel still calls; it is not deleted in this row.
8. **`call_home` has no input validation for jobs.** `stop_job` and `list_jobs` take Home input as is; handlers validate their own args like `set_permission` does.
9. **Timeout of a relayed ask.** `Asks` has a 300 s default timeout. Relayed asks must live as long as the job (bounded by the 30-minute job timeout), so `Asks.open` takes `timeout=None`.

---

# Slice 8a1: ACP runner (brain)

Goal: the brain can start Claude Code over ACP in a folder, set a mode, send a prompt, receive updates, relay permission requests and questions through a callback, cancel, and close. Nothing is wired into Scout yet.

## Task 1: Verification spike (no production code)

Everything after this depends on what you find. If any finding contradicts the design, follow the real API and note the change in the design doc in the same commit.

Files: edit `docs/superpowers/specs/2026-10-27-experts-design.md` (add a "Task 1 findings" section; fix the "recalled or inferred" paragraph). Scratch scripts go in the session scratchpad, not the repo.

Steps:
1. Python package: `uv add agent-client-protocol` in `brain/` in a scratch copy first (or `uv pip install` in a temp venv). Record the exact version, import path, and the client-side API: how to spawn a subprocess agent (for example `spawn_agent_process`), the `Client` interface to implement (`request_permission`, `session_update`, anything for elicitation/questions), `ClientSideConnection` calls (`initialize`, `new_session`, `set_session_mode`, `prompt`, `cancel`), and how the end of a prompt turn is reported (stop reason).
2. Adapter: find the real package name (design says `claude-agent-acp`; the older name was `@zed-industries/claude-code-acp`). Record the `npm` install command and the launch command that works on Windows (`npx`, `.cmd` shim, or a global install; note whether `asyncio.create_subprocess_exec` needs `shell` or the `.cmd` path). Record the Node version it needs.
3. Login: with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unset in the adapter's environment and the user's existing Claude Code login in place, run one trivial prompt ("say hi") through a scratch client. **If it does not run on the existing login, STOP. Do not continue to task 2. Report to the user** with the exact error and what the adapter asks for instead. Also record what happens if the key is present (which one wins), to justify the env strip.
4. Modes: what `session/new` returns for modes (ids and display names, for example default, acceptEdits, plan, bypassPermissions), how to set one, and which are safe to offer. Record the exact ids; they become the hand-off ask's options.
5. Permission requests: capture a real `session/request_permission` (ask Claude Code to create a file in a temp folder in default mode). Record the request shape (tool call title, kind, raw input, the option ids and names) and what the reply must look like (selected option id; cancelled outcome).
6. Questions: make Claude Code ask a question (prompt: "ask me which colour I prefer before doing anything"). Record how it arrives (a permission request for the AskUserQuestion tool, an ACP elicitation, or something else), the question and choices shape, and the answer shape the adapter expects, including a free-text answer.
7. Cancel and end of turn: record the stop reasons, how `session/cancel` ends a running prompt, and whether the adapter process exits on its own when its stdin closes (decides whether the runner must kill the process tree on Windows).
8. Progress text: record which `session/update` kinds carry assistant text (for example `agent_message_chunk`) so the runner can build the "latest progress" and "last agent message".
9. Save one captured transcript of the frames for each of 5, 6 and 7 as small JSON files in `brain/tests/fixtures/acp/` (redact paths). Task 2's fake agent replays their shapes.

Acceptance: findings section in the design doc covers 1-8 with exact names; fixtures committed; login works without an API key (or the builder stopped and reported).

Commit: `docs(experts): ACP spike findings for the Claude adapter (8a1)`

## Task 2: Fake ACP agent for tests

Files: `brain/tests/fake_acp_agent.py` (a runnable script speaking ACP over stdio, built with the `agent-client-protocol` package's agent side, or a minimal JSON-RPC loop if the package has no agent helper), `brain/tests/test_fake_acp_agent.py`.

Behaviour, scripted by a JSON file path in an env var `FAKE_ACP_SCRIPT` (a list of steps; steps are what the real frames in the task 1 fixtures looked like): reply with modes on `session/new`; on `session/prompt`, run the steps: send text chunks, send a permission request and wait for the reply, send a question request and wait, end with a stop reason; honour `session/cancel` by ending the prompt with `cancelled`; log every frame it receives to a file named in `FAKE_ACP_LOG` so tests can assert what the brain sent.

Test first: `test_fake_acp_agent.py` starts the script with the package's client and asserts: initialize works, modes listed, a scripted prompt yields the scripted updates and stop reason, the log holds the prompt text and the set mode.

Acceptance: the fake agent is the only agent any later test uses; running it needs only Python.

Commit: `test(brain): scripted fake ACP agent for expert tests (8a1)`

## Task 3: The runner

Files: `brain/src/brain/experts.py`, `brain/tests/test_experts.py`, `brain/pyproject.toml` (add `agent-client-protocol` pinned to the version from task 1), `brain/src/brain/config.py` + `tests/test_config.py` (add `expert_cmd`, `expert_timeout` fields).

Config: `TAGALONG_EXPERT_CMD` (default the launch command recorded in task 1, as a shell-split list), `TAGALONG_EXPERT_TIMEOUT_S` (default 1800).

Shape (names are guidance; use the real package API from task 1):

```python
class ExpertRun:
    async def start(self, folder: Path) -> list[Mode]        # spawn, initialize, session/new
    async def begin(self, mode_id: str, task: str) -> None   # set mode, send the first prompt (does not wait)
    def note(self, text: str) -> None                         # queue; sent when the current prompt turn ends
    async def stop(self) -> None                               # session/cancel, then end the process tree
    async def close(self) -> None
    progress: str          # latest assistant text
    result: str | None     # last agent message, set at the end
    session_id: str
```

It takes callbacks, so it knows nothing of asks or jobs: `on_permission(request) -> option_id | None`, `on_question(question) -> answer | None` (None means cancelled), `on_progress(text)`, `on_end(state, reason, result)` with state in `done`, `error`, `stopped`.

Test first (all against the fake agent, no Node):
- start returns the scripted modes; begin sends the prompt with the task text and the chosen mode (check the fake's frame log).
- progress updates arrive and `progress` holds the latest; `result` is the last agent message at the end; `on_end("done", ...)`.
- a scripted permission request calls `on_permission`; the returned option id is what the fake receives; returning None sends the cancelled outcome.
- a scripted question calls `on_question`; the answer reaches the fake in the shape from task 1.
- `note()` during a running turn is sent as the next prompt in the same session after the turn ends, and the job ends only after the queued note's turn ends; an idle `note()` after end is refused.
- `stop()` sends cancel and the process is gone; `on_end("stopped", ...)`.
- timeout (inject a short timeout): ends `error`, reason `timeout`, process gone.
- the adapter process crashing mid-run ends `error`.
- the spawn environment has no `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` even when the parent has them (gap 1); everything else is inherited.
- a missing adapter command gives a plain error naming the command and the install step.

Acceptance: pytest green with no Node and no network; the process tree is gone after stop/close on Windows (use the technique found in task 1: `taskkill /T` or closing stdin).

Commit: `feat(brain): ACP runner that drives Claude Code in a folder (8a1)`

## Task 4: Turn-less asks with custom options and free text

Files: `brain/src/brain/asks.py`, `brain/src/brain/sessions.py` (`answer` passes text), `brain/src/brain/server.py` (`answer` passes `reply.text`), tests in `brain/tests/test_asks.py`, `test_sessions.py`, `test_server.py`.

Change: add `Asks.open(*, text, options, tool=None, input=None, timeout=None, free_text=False) -> Answer` where `Answer` is `(option, text)`. No `turn`, no `confirm` (gap 3). With `free_text=True`, an answer whose `option` is not in `options` is accepted when `text` is non-empty (the question case: the user typed their own answer); otherwise unchanged validation. `timeout=None` waits until closed. Add `Asks.cancel_all(prefix_or_ids)` or return a handle so a job can close its asks with reason `cancelled`. `answer(ask_id, option, body_id, text=None)` carries the text through; the closed frame is unchanged. Keep `permission()` working as is.

Test first: open shape validates against `AskParams` (no `turn`, no `confirm`, custom options); answer returns option and text; free-text answer accepted only with `free_text=True`; unknown option still `invalid_params` otherwise; no timeout by default; cancel closes with `reason: cancelled` and the waiter gets a cancelled error; no body online returns immediately as unanswered; first answer wins; server test: an `answer` frame with `text` reaches the ask.

Acceptance: existing ask tests unchanged and green.

Commit: `feat(brain): asks without a turn, with custom options and typed answers (8a1)`

---

# Slice 8a2: Jobs, tools, relays (brain)

Goal: Scout can `hand_off`, `tell_expert`, `list_jobs`, `stop_job`; Claude Code's prompts reach the user; Home can list and stop jobs. No finish turn yet (8a3), so a job's end only updates its row.

## Task 1: Jobs table and store

Files: `brain/src/brain/memory.py` (a new migration appended to `MIGRATIONS`; methods), `brain/tests/test_memory.py`.

Table `jobs(id TEXT PRIMARY KEY, agent TEXT, task TEXT, folder TEXT, mode TEXT, state TEXT, reason TEXT, progress TEXT, result TEXT, session_id TEXT, reported INTEGER DEFAULT 0, started_at TEXT, ended_at TEXT)`. Methods: `add_job(...)`, `update_job(id, **fields)`, `get_job(id)`, `list_jobs(limit=20)` newest first, `running_jobs()`, `stop_running_on_start()` (rows still `running` become `stopped`, reason `brain restarted`, `ended_at` set), `unreported_jobs()`, `mark_reported(id)`.

Test first: migration from an existing v-previous database keeps data; round trip; newest-first order and limit; restart cleanup only touches `running`; `unreported_jobs` returns finished unreported only; progress and result stored as given (result trimmed at a stored cap of 20,000 chars).

Commit: `feat(brain): jobs table and store (8a2)`

## Task 2: Gate flag for tools that ask for themselves (gap 2)

Files: `brain/src/brain/toolbox.py`, `brain/src/brain/tools.py` (`list_permissions` row gets `self_asks`), `brain/tests/test_toolbox.py`, `test_tools.py`.

Change: `ToolSpec.self_asks: bool = False`. `Toolbox.mode()` returns `auto` for it (gate step 3 skipped) and `set_mode` refuses changing it with "<name> asks for itself." `list_permissions` rows include `self_asks`; `locked` stays false for it so existing consumers are unchanged. (Desktop shows it in 8b.)

Test first: a Scout call to a self-asking tool opens no permission ask; `set_permission` refuses; `list_permissions` reports it; existing locked/ask behaviour unchanged.

Commit: `feat(brain): tools that ask the user for themselves skip the gate ask (8a2)`

## Task 3: The job manager

Files: `brain/src/brain/jobs.py`, `brain/tests/test_jobs.py`.

`Jobs(memory, asks, notify, make_run, max_running=2)` owns running jobs in memory (id -> `ExpertRun`) and wires the runner callbacks:
- `start(task, folder)` (the full hand-off): validates the folder (absolute, exists, directory; plain message otherwise, "no folder at C:\..."); refuses a third running job naming the running ones; `run.start` then opens the hand-off ask through `asks.open` (`text` = task, folder shown, `options` = mode names + `cancel`); `cancel`, a timeout or nobody online closes the run and returns "not started"; a mode answer calls `begin`, adds the row (`running`), sends `changed: jobs`, returns the job id.
- `on_permission(request)`: `asks.open(tool="claude_code:<title>", input=<tool call details>, text="", options=<request option names>)`, maps the picked name back to the option id, sends `changed: jobs` after the answer. No answer (nobody online, cancelled) returns None (cancelled outcome).
- `on_question(question)`: `asks.open(text=question, options=choices, free_text=True)`; typed text wins when given.
- `on_progress`: `update_job(progress=...)` (cheap, no `changed` per chunk; throttle one `changed` per 2 s at most).
- `on_end(state, reason, result)`: write the row (`ended_at`), close the job's open asks as `cancelled`, send `changed: jobs`, call the injected `on_finished(job)` (a no-op until 8a3).
- `tell(job, note)`: only for a running job; else a plain error. `stop(job)`: only running; else a plain error. `list()`: last 20 with latest progress.
- `startup()`: `memory.stop_running_on_start()`.

Test first (fake agent through the real `ExpertRun`, fake asks/notify where simpler): every bullet above, including: bad folder; third job refused; cancel at the mode ask spawns nothing that lingers; a relayed permission shows `tool` `claude_code:...` and the right option comes back; a question with typed text; stop closes open asks; `changed: jobs` after each state change; restart cleanup.

Commit: `feat(brain): job manager with hand-off ask and relayed prompts (8a2)`

## Task 4: The four tools, wiring and docs

Files: `brain/src/brain/tools.py` (`expert_tools(jobs)` returning specs and handlers), `brain/src/brain/sessions.py` (build `Jobs`, add the tools, call `jobs.startup()`), `brain/src/brain/main.py` if the config needs passing, `brain/tests/test_tools.py`, `test_sessions.py`, `docs/brain.md`, `README.md`, `CLAUDE.md` (setup line for the adapter), `docs/testing/feature-test-guide.md`.

Tools as in the design table: `hand_off {task, folder}` (scout, change, `self_asks`; description tells the model to use the folder the user named and to ask the user when no folder was named, never guess; returns id and "started" or the plain reason), `tell_expert {job, note}` (scout, change, default auto), `list_jobs` (scout and home, read), `stop_job {job}` (scout and home, change, default auto). Handlers return JSON text for Home tools, a plain line for Scout. Bad args raise `MemoryRefused`/`RpcError` like the existing tools.

Test first: spec audiences and effects; `hand_off` reaches `Jobs.start`; the model tools list contains the four with the right schemas; `list_jobs` and `stop_job` work through `call_home`; `hello` home tools include `list_jobs` and `stop_job`; `list_permissions` shows `hand_off` as self-asking.

Docs in this task: docs/brain.md gets an "Experts" section (runner, ACP, jobs table, tools table, relayed asks, timeouts, caps, `changed: jobs`, env strip, the new `Asks.open`), the config table gains `TAGALONG_EXPERT_CMD` and `TAGALONG_EXPERT_TIMEOUT_S`, and the Files list gains `experts.py` and `jobs.py`. README and CLAUDE.md: one line on installing the adapter (the exact command from 8a1 task 1; Node needed) and that Claude Code must be logged in. feature-test-guide: a "Hand off to Claude Code (real brain, real Claude Code)" section (hand off with folder named, folder not named so Scout asks, mode buttons, permission relay, question relay, stop, restart marks stopped).

Acceptance: full brain suite green; ruff clean.

Commit: `feat(brain): hand_off, tell_expert, list_jobs, stop_job for Scout and Home (8a2)`

---

# Slice 8a3: Wake turn and finish report (brain)

Goal: when a job ends, the brain starts its own turn so Scout tells the user.

## Task 1: Session.wake

Files: `brain/src/brain/sessions.py`, `brain/tests/test_sessions.py`.

- Session remembers `_last_body` (set in `say`).
- `wake(event_text)`: queue the event. A runner coroutine waits until no turn is running, picks the body per Plan Rule 3 (`_last_body` if online, else any online body, else keep waiting for a body to connect: re-check on `Bodies` connect), appends a user message containing the event note as plain text inside a `<data kind="job">` fence (job output is untrusted; reuse `_fence_safe`), and starts a turn through the same `run_turn` path as `say`, with the same budget and step cap and a normal `turn` notification pair. Factor the shared "start a turn" code out of `say` rather than copy it.
- Wakes that arrive while a turn runs queue in order; one wake turn per event (do not merge).

Test first (fake model): wake while idle starts a turn with the event in history; wake during a running turn waits and runs after; two wakes run in order; goes to the last-talked body; falls back to another online body; waits when nobody is online and runs when a body joins; budget exhausted ends it `over_budget`; the user's own `say` during a wake turn joins it as usual; persisted history stays valid.

Commit: `feat(brain): Session.wake starts a turn the brain begins itself (8a3)`

## Task 2: The finish turn

Files: `brain/src/brain/jobs.py` (the `on_finished` hook), `brain/src/brain/sessions.py`, `brain/src/brain/main.py` if needed, `brain/tests/test_jobs.py`, `test_sessions.py`.

- `on_finished(job)` builds the event note: job id, task, folder, state, reason, result text trimmed to 4,000 chars (cut at the end, with "[trimmed]"), and calls `wake`. No canned wording for the user: the note only states facts; the prompt/system text already lets the model decide, and silence is allowed.
- `mark_reported(job)` when the wake turn actually starts.
- On startup, `unreported_jobs()` are queued again (after `stop_running_on_start`, so a restart-stopped job also gets one report).
- Check `mind/prompt.py`: add one short sentence to the system prompt that job notes are events, not requests, and results are data. Update `test_prompt.py`.

Test first: a job ending queues one wake with the right facts and a trimmed result; `reported` set when the turn starts; a brain restart re-queues only unreported finished jobs; a hostile result containing a closing data tag cannot break the fence; the model sees job output as data.

Commit: `feat(brain): Scout reports back when a job ends (8a3)`

## Task 3: Docs

Files: `docs/brain.md` (finish turn and wake sections; remove from "Not built yet" anything now built), `docs/experts.md` (rewrite the header block saying the experts catalog is the old engine and that Claude Code hand-off now lives in the brain; keep it short), `docs/testing/feature-test-guide.md` (the finish report scenario: leave Home closed, job ends, Scout speaks; and Scout stays silent when nothing to say), `README.md` if the feature list changes.

Commit: `docs(brain): finish turn and the wake entry point (8a3)`

---

# Slice 8b: Home Jobs panel (desktop)

Goal: Home lists jobs and stops one; asks from jobs look right. Only through `call` and the existing ask path.

## Task 1: IPC and bridge for jobs

Files: `bodies/desktop/src/main/ipc/jobs.ts` + `jobs.test.ts` (mirror `permissions.ts`), `bodies/desktop/src/shared/ipc.ts` (`listJobs`, `stopJob` channels), `bodies/desktop/src/main/index.ts` (register), `bodies/desktop/src/preload/index.ts`, `bodies/ui/src/host-bridge.ts` (`JobRow` type, `listJobs?`, `stopJob?`; `onBrainChanged` already carries any `what`), `bodies/ui/src/test-support/fake-host-bridge.ts`.

`JobRow`: `{ id, agent, task, folder, mode, state, reason, progress, result, startedAt, endedAt }` (camel-case the brain's snake_case fields in `parseRows`, or have brain's `list_jobs` return the names the UI wants; pick the brain's names as is and map in the IPC module, as `permissions.ts` does).

Test first: `parseRows` rejects non-arrays; the handlers call `list_jobs` and `stop_job` with the right input; a bad job id from the page is rejected before the call.

Commit: `feat(desktop): list and stop jobs through the brain (8b)`

## Task 2: Jobs panel

Files: `bodies/ui/src/home/jobs-panel.tsx` + `jobs-panel.test.tsx`, `bodies/ui/src/home/home-view.tsx` (render it on the Experts page above `ExpertsPanel`), `bodies/ui/src/home/home-styles.ts`, `bodies/ui/src/home/home-view.test.tsx`.

First check what the old `ExpertsPanel` still calls; if it only talks to the old engine and breaks without it, leave it hidden behind the same checks it already has. Do not delete it in this row (record in the PR if it looks dead).

Panel: card "Jobs" (read DESIGN.md and follow the permissions panel's patterns: `home-card`, label, list). One row per job: task, folder, mode, state badge (running, done, error, stopped), latest progress line, start time or duration, result under an expand control when finished, **Stop** on running rows. Empty state line. Refetch on mount and on `onBrainChanged('jobs')`; a failed read shows the same alert pattern as Permissions; Stop failure re-reads and logs. Accessible names; no colour-only state. Return null when the bridge has no `listJobs`.

Test first: renders rows; Stop calls `stopJob` and re-reads; refetches on `changed: jobs`; empty state; failed read alert; result expands; running row shows Stop, finished does not; null without bridge.

Commit: `feat(desktop): Jobs panel in Home (8b)`

## Task 3: Hand-off and relayed asks look right

Files: check first, change only what is wrong: the ask mapper in `bodies/desktop/src/main/brain/turn-events.ts` (+ test), the ask card in `bodies/ui`, `bodies/ui/src/home/permissions-panel.tsx` (show "Asks itself" for `self_asks`, switch disabled).

Checks (write a failing test for each thing that is wrong, then fix):
- the hand-off ask (no `turn`, no `confirm`, options = modes + `cancel`, text = task, folder in the text) renders as buttons and the click sends `answer` with that option;
- a relayed permission ask (no `turn`, no `confirm`, `tool` `claude_code:...`, custom options, `input` set) shows tool and input and the option buttons (gap 3); if the card only shows tool and input for confirm asks, extend it for any ask that has `tool`;
- a question ask lets the user type free text and sends `answer` with `text` (the contract field exists; the desktop must send it, gap 4); if the card has no text field, add one only when the ask is a question (no `tool`);
- a turn-less ask appears with no turn running and closes cleanly on `closed: cancelled`.

Commit: `fix(desktop): show job asks, typed answers and self-asking tools (8b)` (or `test(desktop): ...` if nothing needed fixing)

## Task 4: E2E on the fake brain, docs

Files: `bodies/desktop/e2e/fixtures/fake-brain.ts` (answer `list_jobs` and `stop_job`; a say containing "hand off" opens a turn-less mode ask and then a relayed permission ask and a question ask, and records answers incl. `text`), `bodies/desktop/e2e/jobs.spec.ts`, `docs/desktop.md` (IPC table row for `jobs.ts`, the Jobs panel, the ask cases), `docs/testing/feature-test-guide.md` (desktop steps for Jobs panel), `README.md` if user-facing text changes.

Spec: Home Experts page shows the fake job; Stop reaches `stop_job`; the hand-off mode ask is answered with a mode button and the fake records it; the relayed permission ask is answered; the question is answered with typed text and the fake records `text`; `changed: jobs` from the fake refreshes the panel.

Acceptance: `pnpm --filter @tagalong/desktop test:e2e` green for the new spec; `pnpm test`, typecheck, lint, format all green. Run the e2e suite for the new spec at least (full suite runs in CI).

Commit: `test(desktop): jobs and job asks on the fake brain (8b)`

---

## Done when

- Everything above merged; tracker rows 8a1, 8a2, 8a3, 8b Done with PR links.
- Manual pass of the new feature-test-guide sections with real Claude Code on the user's login (the user runs it; the builder lists the steps).
- Notion Plan and Launch board text updated by `notion-tracker`; the next row named.
