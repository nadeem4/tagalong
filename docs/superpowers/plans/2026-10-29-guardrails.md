# Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every guardrail in the Python brain runs through one small framework (ordered guards per hook point, one log line per refusal, one config), then the missing guards are added: locked-tool unlock, a Scout turn time limit, expert news while the person is away, and secrets kept off disk.

**Architecture:** A new `brain/src/brain/guards.py` holds the types and the runner (a plain ordered list of guards per hook). `brain/src/brain/builtin_guards.py` holds the built-in guards as plain functions. The thinking loop, toolbox, jobs and scheduler call the runner instead of their own inline checks. `guardrails.py` keeps only the spend ledger (`Budget`). G1 and G2 move existing behavior; G3 and G4 add.

**Tech Stack:** Python 3.12, pytest-asyncio, SQLite (`memory.py`); TypeScript, React, vitest (G2 Home switch only).

**Spec:** `docs/superpowers/specs/2026-10-29-guardrails-design.md` (approved). Style reference: `docs/superpowers/plans/2026-10-28-learned-approvals.md`.

## Global Constraints

- Contract v1 (`protocol/README.md`) does not change. Verdicts surface through existing reasons: `over_budget`, `step_cap`, `error`, `denied`, `timeout`.
- No plugin loading, no rules language, no registry beyond one plain ordered list per hook. No second budget, no second config, no guard that logs elsewhere.
- G1 and G2's migrations are behavior-preserving: existing tests stay green and no env var changes name or meaning. G2's locked-tool rule is the one stated behavior change; its PR names it.
- Failure rules (spec Constraints): a guard that raises counts as block and is logged; spend and tool hooks fail closed. A side-check that raises or times out falls through to the person ask. A masking guard that raises withholds the text rather than saving it raw.
- Guards run on the event loop: quick, or async with their own time limit. Guards get their settings when registered, not by importing `config`.
- Log: logger `brain.guardrails`, INFO, one line per refusing verdict: `guard=<name> hook=<hook> verdict=<kind> reason=<text>` plus `turn=<id>` when known. Never tool input or result text. Allow is not logged.
- Plumbing limits stay where they are (reconnect buffer, history trim 50, page sizes, char caps, body 30 s, app 60 s, expert 1800 s and 60 s, side-check 20 s, person ask 300 s). Not masked: Scout's live turn and the side-check prompt.
- Every new file opens with a 2-6 line header; comments say why, not history. Diagrams, if any, are black-and-white Mermaid opening with `%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%`.
- **No Claude or AI attribution anywhere**: no "Co-Authored-By" trailer, no "Generated with" line, no robot emoji or Claude link in commits, PR titles or bodies, docs or code. Applies to every sub-agent.
- TDD: failing test first, watch it fail, then implement. Commits and PR titles are Conventional Commits, lowercase, under 72 chars, `type(scope): plain words (G1)`. PR bodies follow `.github/pull_request_template.md`; no Notion links.
- Each slice is one PR of about 500-1,000 changed lines (lockfiles excluded), in a fresh session. Docs are part of done: `README.md` where it lists settings or user-facing behavior, the matching `docs/` file, `docs/testing/feature-test-guide.md` (by-hand steps), and the CLAUDE.md Layout line for new brain files.
- Brain checks: `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`. TS checks: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.

## Review Focus

1. A guard that raises (or an ask chain that errors) lets the action through. Expected: refused and logged. Pinned in G1 T1 and G2 T2.
2. The turn timeout (300 s) fires while a tool waits on the person's ask (also up to 300 s). Expected: waiting on tools does not use up the turn clock. Pinned in G3 T1.
3. A locked tool runs without the person's explicit unlock: under a general preference, with the builtin default deleted, or after the Home switch is flipped back to Ask. Expected: it asks. Pinned in G2 T5.
4. A secret survives masking in a nested place (tool_use input, tool_result block list, job result, log arg) or a very short secret value masks ordinary words. Expected: all `[secret]`; values under 8 chars are never matched. Pinned in G4 T2, T3.
5. An expert asks or dies while nobody is online and the person never hears. Expected: told when they are back. Pinned in G3 T2.
6. A guard's log line leaks tool input or result text. Expected: reasons are plain words only. Pinned in G1 T1.

## File Structure

| File | Responsibility |
| --- | --- |
| `brain/src/brain/guards.py` (new, G1) | `Hook`, `Verdict`, contexts, `Guard`, `Guards` runner, the log line |
| `brain/src/brain/builtin_guards.py` (new, G1) | built-in guards as plain functions; `spend_guards(budget, step_cap)` default list |
| `brain/src/brain/guardrails.py` | `Budget` ledger and prices only (unchanged) |
| `brain/src/brain/masking.py` (new, G4) | `Masker` and the `mask_secrets` save guard |
| `brain/src/brain/sessions.py` | builds the one `Guards` list and registers guards in order |

---

## Slice G1: Framework, daily budget, step cap (behavior-preserving)

Branch `feat/g1-guardrail-framework`. About 600 changed lines, 4 tasks. PR title `feat(brain): one guardrail framework for budget and step cap (G1)`.

**Done when:** runner tests pass (order, short-circuit, rewrite chaining, raising guard is a block, one log line per refusal, no input text in the log); existing turn, side-check, offers and scheduler tests pass with no assertion edited; `over_budget` and `step_cap` come out as before; no env or protocol change; docs updated.

**Docs:** `docs/brain.md` (new "Guardrails" section: hook table, verdicts, log line, mermaid runner flow; Files list gains `guards.py`, `builtin_guards.py`), `docs/settings-and-secrets.md` (where guard settings live), `docs/testing/feature-test-guide.md` (set `TAGALONG_DAILY_BUDGET_USD` tiny and `TAGALONG_STEP_CAP=1`, confirm Scout stops and a `guard=` line appears in the brain log), `README.md` only if it lists settings (no change expected), CLAUDE.md Layout line (add `guards.py`).

### Task 1: Types and runner

**Files:**
- Create: `brain/src/brain/guards.py`
- Test: `brain/tests/test_guards.py`

**Interfaces:**
- Produces `class Hook(StrEnum)`: `model_call, tool_call, ask, tool_result, emit, save`.
- Produces `@dataclass(frozen=True) class Verdict(kind: Literal["allow","ask","block","stop","rewrite"], reason: str = "", code: str = "", value: Any = None, once: bool = False, guard: str = "")`. `code` is the machine reason (`over_budget`, `step_cap`, an `ErrorCode` value). `once=True` on allow means "approved for this one call" (side-check). `guard` is filled by the runner.
- Produces helpers `ALLOW`, `ask(reason)`, `block(reason, code="")`, `stop(reason, code)`, `rewrite(value)`, `allow_once(reason, value=None)`.
- Produces `@dataclass(frozen=True) class Guard(name: str, hook: Hook, check: Callable[[Any], Verdict | Awaitable[Verdict]])`.
- Produces `class Guards`: `add(guard: Guard) -> None` (appends; order is registration order), `async run(hook: Hook, ctx: Any) -> Verdict`, `run_sync(hook: Hook, ctx: Any) -> Verdict` (a guard that returns an awaitable here counts as a raise). Result: the first `block`/`stop`, else for the `ask` hook the first `allow` with `once=True` (short-circuits), else `ask` if any guard asked, else `rewrite` carrying the final value if any guard rewrote, else `ALLOW`. A `block` beats an `ask`. `rewrite` is only meaningful on the `save` hook: the runner passes later guards `dataclasses.replace(ctx, text=new)`, so a guard always reads `ctx.text`.
- Contexts (frozen dataclasses): `ModelCallCtx(kind: Literal["turn","side_check","offer"], turn_id: str | None, steps: int)`, `ToolCallCtx(spec: ToolSpec, input: dict, caller: str, source_kind: str, turn_id: str | None)`, `AskCtx` (G2), `EmitCtx` (G2), `SaveCtx(what: Literal["chat","approval","job_result","log"], text: str)`.

- [ ] **Step 1: Write failing tests** in `test_guards.py`: `test_guards_run_in_registration_order`; `test_first_block_short_circuits_later_guards`; `test_stop_short_circuits_and_keeps_code`; `test_block_beats_ask`; `test_ask_when_only_asks`; `test_rewrite_feeds_the_next_guard` (two `save` guards: first upper-cases, second asserts it sees the upper-cased text; result kind `rewrite`, value upper-cased); `test_allow_once_short_circuits_on_ask_hook`; `test_raising_guard_is_block_with_code_error` (sync and async raising guard; reason is plain words, exception not in reason); `test_run_sync_rejects_async_guard_as_block`; `test_no_guards_for_hook_is_allow`; `test_guard_for_other_hook_never_runs`; `test_one_log_line_per_refusal` (caplog on `brain.guardrails`: block, stop, ask each log exactly `guard=<name> hook=<hook> verdict=<kind> reason=<text>` plus ` turn=t1` when ctx has `turn_id`; allow and rewrite log nothing); `test_log_never_contains_tool_input` (ToolCallCtx input `{"secret":"hunter2"}`, guard blocks with a plain reason, `"hunter2"` not in `caplog.text`).
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_guards.py -v`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement `guards.py` as above. Approach: one private `_fold(self, hook, ctx, results_iter)` shared by `run` and `run_sync` so the verdict rules live once; catch `Exception` only (never `CancelledError`).
- [ ] **Step 4:** Re-run; expect PASS. `uv run ruff check && uv run ruff format --check`.
- [ ] **Step 5:** Commit `feat(brain): guard types and runner (G1)`.

### Task 2: Budget and step-cap guards on `model_call`; the turn loop uses them

**Files:**
- Create: `brain/src/brain/builtin_guards.py`
- Modify: `brain/src/brain/mind/turn.py:68-97` (`run_turn` signature and the two checks)
- Test: `brain/tests/test_builtin_guards.py`; `brain/tests/test_turn.py` (no assertion edited)

**Interfaces:**
- Consumes: `Guards`, `Guard`, `Hook`, `ModelCallCtx`, `stop` from T1; `Budget.allows()`.
- Produces `daily_budget(budget: Budget) -> Guard` (hooks `model_call`; returns `stop("daily budget spent", "over_budget")` when `not budget.allows()`), `step_cap(cap: int) -> Guard` (`model_call`; `stop("step limit reached", "step_cap")` when `ctx.kind == "turn" and ctx.steps >= cap`), `spend_guards(budget, cap) -> Guards` (budget first, then step cap).
- Produces `run_turn(..., guards: Guards | None = None)`: `None` builds `spend_guards(budget, step_cap)`, so existing callers and tests are unchanged. The loop runs `await guards.run(Hook.model_call, ModelCallCtx("turn", turn_id, steps))` where it now checks `budget.allows()` then `steps == step_cap`, and ends with `verdict.code` as the reason. Order stays budget before step cap.

- [ ] **Step 1: Write failing tests:** `test_builtin_guards.py`: `test_daily_budget_stops_with_over_budget_when_spent`; `test_daily_budget_allows_under_limit`; `test_step_cap_stops_at_cap_for_turns`; `test_step_cap_ignores_side_check_and_offer_calls` (kind `side_check`, steps 99, allow); `test_spend_guards_check_budget_before_step_cap`. `test_turn.py`: `test_run_turn_uses_given_guards` (a fake guard that stops with code `step_cap` after one call ends the turn with that reason).
- [ ] **Step 2:** `uv run pytest tests/test_builtin_guards.py tests/test_turn.py -v`. Expect FAIL (new tests only).
- [ ] **Step 3:** Implement the three functions and the `run_turn` change. A stop verdict's `code` becomes `reason` in the existing `break` path; delete the inline checks.
- [ ] **Step 4:** Re-run; then `uv run pytest tests/test_turn.py tests/test_sessions.py` unchanged-green.
- [ ] **Step 5:** Commit `refactor(brain): turn loop asks the guards for budget and step cap (G1)`.

### Task 3: Side-check, offers and scheduler use the runner

**Files:**
- Modify: `brain/src/brain/side_check.py:65-77`, `brain/src/brain/offers.py:104`, `brain/src/brain/scheduler.py:116-120`, `brain/src/brain/sessions.py:54-110`
- Test: `brain/tests/test_side_check.py`, `test_offers.py`, `test_scheduler.py` (no assertion edited); one new test each as named

**Interfaces:**
- Consumes: T2 `spend_guards`, `Guards.run`, `Guards.run_sync`.
- Produces optional `guards: Guards | None = None` on `SideCheck.__init__`, `Offers.__init__` and `Scheduler.__init__`; `None` builds `spend_guards(budget, 25)` so existing constructors in tests are unchanged. `SideCheck.decide` replaces `self._budget.allows()` with `(await guards.run(Hook.model_call, ModelCallCtx("side_check", None, 0))).kind != "allow"` (return `None`); `Offers` likewise with kind `"offer"`. `Scheduler.pump` replaces `not self._budget.allows()` with `guards.run_sync(Hook.emit, EmitCtx(kind=None, ...)).code == "over_budget"` then `_drop_all()`. Budget `spend` calls stay on `Budget`.
- Produces `EmitCtx(kind: EventKind | None, now: datetime, wakes: Sequence[tuple[datetime, str]])` in `guards.py`; `daily_budget` is also registered on `emit` (one guard, two hooks: give `daily_budget` a `hooks` tuple or register two `Guard`s with the same check; builder's choice, one name `daily_budget` in logs).
- `Session` builds one `Guards` (`spend_guards(budget, step_cap)`) in `__init__` before the scheduler, stores `self.guards`, and passes it to `Scheduler`, `SideCheck`, `Offers` and `run_turn`.

- [ ] **Step 1: Write failing tests:** `test_side_check.py::test_decide_stops_when_the_guards_stop` (fake `Guards` stopping `model_call` returns None, no model call); `test_offers.py::test_consider_skips_look_when_the_guards_stop`; `test_scheduler.py::test_pump_drops_events_when_the_emit_guard_stops_with_over_budget`; `test_sessions.py::test_session_shares_one_guards_with_scheduler_and_loop` (set the budget exhausted, a `say` ends `over_budget`, a queued wake is dropped).
- [ ] **Step 2:** `uv run pytest tests/test_side_check.py tests/test_offers.py tests/test_scheduler.py tests/test_sessions.py -v`. Expect the four new tests FAIL.
- [ ] **Step 3:** Implement the wiring as above. `Scheduler.pump` is sync, so it uses `run_sync`.
- [ ] **Step 4:** `uv run pytest` whole brain. Expect PASS with no existing assertion changed (`git diff --stat tests/` shows only added lines in these files).
- [ ] **Step 5:** Commit `refactor(brain): side-check, offers and scheduler use the guards (G1)`.

### Task 4: Docs

**Files:** modify `docs/brain.md`, `docs/settings-and-secrets.md`, `docs/testing/feature-test-guide.md`, `CLAUDE.md` (Layout line), `brain/src/brain/guardrails.py` header only if it still says it holds all guardrails.

- [ ] **Step 1:** Write the docs listed above (hook table from the spec, verdict table, runner flow as black-and-white Mermaid, log line format, "adding a guard = one function, one test, one `add` in `sessions.py`").
- [ ] **Step 2:** `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; `pnpm format:check` (docs are prettier-checked). Expect PASS.
- [ ] **Step 3:** Commit `docs(brain): guardrail framework and hook list (G1)`.

---

## Slice G2: Tool gate, ask chain, wake caps, locked-tool rule

Branch `feat/g2-tool-gate-locked-rule`. About 900 changed lines, 6 tasks. PR title `feat(brain): gate and ask chain on guards, locked-tool rule (G2)`. The PR body names the behavior change: a locked tool now runs when the person flips its Home switch to Auto or when a preference names it; before, it always asked.

**Done when:** all existing toolbox, asks, side-check, jobs and scheduler tests pass, edited only where the locked rule changes the expected result; one test per guard and one end-to-end test per path; a locked tool asks by default, runs after the Home switch, runs under a preference naming it, and does not run under a general preference even with the builtin default deleted; `Jobs._permission` no longer holds its own copy of the sequence; the PR names the behavior change.

**Docs:** `docs/asks.md` (ask chain order, locked rule, "Always" stays hidden for locked), `docs/brain.md` (Toolbox and Permissions sections now describe guards; Home-tools mode semantics), `docs/connected-apps.md` (locked app tools can be unlocked on Home), `docs/testing/feature-test-guide.md` (by hand: a locked tool asks; flip its Home switch, read the warning, it runs; flip back, it asks; delete the default preference, a general preference does not approve it), `README.md` if it describes "always asks" for risky tools.

### Task 1: `tool_mode` guard on `tool_call` (behavior-preserving)

**Files:**
- Modify: `brain/src/brain/builtin_guards.py`, `brain/src/brain/toolbox.py:149-159,256-265`
- Test: `brain/tests/test_builtin_guards.py`, `brain/tests/test_toolbox.py` (existing unchanged)

**Interfaces:**
- Consumes: `ToolCallCtx` (T1 of G1).
- Produces `resolve_mode(spec: ToolSpec, stored: str | None) -> Literal["ask","auto"]` (today's order: `self_asks` -> ask; `locked` -> ask; stored ask/auto; `default_mode`; auto for `effect == "read"`, else ask). `Toolbox.mode(spec)` becomes `resolve_mode(spec, self._modes().get(spec.name))` so the Home permission list uses the same function.
- Produces `tool_mode(modes: Callable[[], dict[str, str]]) -> Guard` on `tool_call`: `ALLOW` when `ctx.caller == "home"`; `ask("needs your yes")` when the resolved mode is ask; else `ALLOW`. `Toolbox.run` replaces `caller != "home" and self._asks is not None and self.mode(spec) == "ask"` with: guards `tool_call` verdict; `ask` -> `_ask`, `block` -> `RpcError(ErrorCode(code), reason)`.

- [ ] **Step 1: Write failing tests** (`test_builtin_guards.py`): `test_tool_mode_asks_for_change_tools_by_default`; `test_tool_mode_allows_reads_by_default`; `test_tool_mode_stored_auto_allows`; `test_tool_mode_self_asks_resolves_to_ask`; `test_tool_mode_home_caller_skips_the_ask`; `test_tool_mode_default_mode_beats_effect`. `test_toolbox.py::test_run_blocks_when_a_tool_call_guard_blocks` (injected guard).
- [ ] **Step 2:** `uv run pytest tests/test_builtin_guards.py tests/test_toolbox.py -v`. Expect FAIL on new tests.
- [ ] **Step 3:** Implement. `Toolbox.__init__` gains `guards: Guards | None = None` (None -> a `Guards` with `tool_mode(modes)` only, so existing toolbox tests are unchanged). Keep the `_asks is None` skip.
- [ ] **Step 4:** Re-run plus whole `tests/test_toolbox.py tests/test_tools.py tests/test_app_tools.py`. Expect PASS.
- [ ] **Step 5:** Commit `refactor(brain): tool mode is a guard on tool_call (G2)`.

### Task 2: Ask chain on the `ask` hook (tool gate)

**Files:**
- Modify: `brain/src/brain/builtin_guards.py`, `brain/src/brain/guards.py` (add `AskCtx`), `brain/src/brain/toolbox.py:208-254` (`_ask`), `brain/src/brain/sessions.py`
- Test: `brain/tests/test_builtin_guards.py`, `brain/tests/test_toolbox.py`

**Interfaces:**
- Produces `AskCtx(source: str, tool: str, summary: str, input: dict, group_key: str, locked: bool, turn_id: str | None, ask_person: Callable[[], Awaitable[str]])`. `ask_person` does the wire work and returns `"allow"`, `"always"` or `"deny"`; it raises `RpcError` for timeout or cancel.
- Produces three guards on `ask`, registered in this order: `anyone_online(asks) -> Guard` (`block(<existing "not connected" message>, "denied")` when nobody is online; the builder copies the current text from `toolbox.py:224-228`), `side_check_guard(side_check, approvals) -> Guard` (calls `side_check.decide(AskFacts(...))`; a preference returns `allow_once("approved under a preference", value=pref)` after `approvals.scout_approved(...)`; `None` returns `ALLOW`; any exception is logged and returns `ALLOW`, falling through to the person), `person_ask() -> Guard` (awaits `ctx.ask_person()`; `"deny"` -> `block("The user said no to <tool>.", "denied")`; `RpcError` with timeout/cancelled -> `block(exc.message, exc.code)`; `"allow"`/`"always"` -> `allow_once(value=choice)`).
- `Toolbox._ask` builds `AskCtx`, runs `Hook.ask`, then the after-answer steps stay in `_ask` outside the list: record the row (`approved`, `refused`, `timed_out` on a timeout block, `no_one` when the guard is `anyone_online`; a `cancelled` block records nothing), set `auto` on `"always"`, call `offers.consider`. It re-raises blocks as `RpcError(code, reason)` with the exact existing messages and codes.

- [ ] **Step 1: Write failing tests** (builtin_guards): `test_anyone_online_blocks_with_denied_when_nobody_is_online`; `test_anyone_online_allows_when_someone_is_online`; `test_side_check_guard_allow_once_with_preference_and_records_scout_row`; `test_side_check_guard_falls_through_when_decide_returns_none`; `test_side_check_guard_falls_through_when_decide_raises`; `test_person_ask_allow`; `test_person_ask_always_value`; `test_person_ask_deny_blocks_with_denied`; `test_person_ask_timeout_blocks_with_timeout_code`; `test_ask_chain_order_is_online_then_side_check_then_person` (registration order list in `Session`, asserted by guard names). `test_toolbox.py`: `test_chain_error_in_an_ask_guard_refuses_the_tool` (a raising guard registered on `ask`: tool does not run, `RpcError`), plus the existing record/always/deny/timeout/no_one tests stay green unchanged.
- [ ] **Step 2:** `uv run pytest tests/test_builtin_guards.py tests/test_toolbox.py -v`. Expect new tests FAIL.
- [ ] **Step 3:** Implement the three guards and the `_ask` rewrite. `Session` registers `tool_mode`, then `anyone_online`, `side_check_guard`, `person_ask` on its `Guards` and passes it to `Toolbox`.
- [ ] **Step 4:** `uv run pytest` whole brain; existing toolbox/asks/side-check tests unchanged and green.
- [ ] **Step 5:** Commit `refactor(brain): the tool-gate ask sequence is a guard chain (G2)`.

### Task 3: Expert permission relay uses the same chain

**Files:**
- Modify: `brain/src/brain/jobs.py:184-257` (`_permission`, `_scout_approval`), `brain/src/brain/sessions.py`
- Test: `brain/tests/test_jobs.py`

**Interfaces:**
- Consumes: T2 guards and `AskCtx` with `source="claude_code"`, `tool=f"claude_code:{request.title}"`, `group_key=f"claude_code:{folder}"`, `locked=False`.
- Produces: `Jobs(..., guards: Guards | None = None)` (None keeps today's behavior by building the chain locally from its own `asks`, `side_check`, `approvals`, so existing `Jobs` tests are unchanged). `_permission` builds `AskCtx` whose `ask_person` calls `_open_ask` and maps the picked ACP option (by `kind`, never by name) to `"allow"`/`"deny"`; the option it picked is kept in a closure for the return value. A `once` approval from the side-check returns the `allow_once` option id; people-approved returns `picked.id`; refused returns the picked reject option id; `timed_out` returns None. `_record`, `_offer`, `_changed` stay as after-answer steps. `_scout_approval` is deleted.

- [ ] **Step 1: Write failing tests:** `test_permission_runs_the_shared_ask_chain` (injected guards record the `AskCtx.source == "claude_code"` and the group key); `test_permission_side_check_approval_picks_allow_once_option_never_allow_always`; `test_permission_chain_guard_error_refuses_without_hanging`; the existing permission tests (allow kinds, reject kinds with odd names, timeout, nobody online) stay green unchanged.
- [ ] **Step 2:** `uv run pytest tests/test_jobs.py -k permission -v`. Expect new FAIL.
- [ ] **Step 3:** Implement; delete the duplicated sequence.
- [ ] **Step 4:** `uv run pytest tests/test_jobs.py tests/test_sessions.py`. Expect PASS.
- [ ] **Step 5:** Commit `refactor(brain): expert permission asks use the shared ask chain (G2)`.

### Task 4: `wake_caps` guard on `emit`

**Files:**
- Modify: `brain/src/brain/builtin_guards.py`, `brain/src/brain/scheduler.py:116-188`
- Test: `brain/tests/test_builtin_guards.py`, `brain/tests/test_scheduler.py` (unchanged)

**Interfaces:**
- Produces `wake_caps(per_hour: int) -> Guard` on `emit`: for a ctx with a `kind` that has `max_per_hour`, counts `ctx.wakes` inside the last 3600 s (per kind, then overall against `per_hour`); when a cap is reached returns `block("wake cap reached", "held")` with `value` = seconds until enough wakes age out (a float). `Scheduler._cap_wait(kind)` becomes: run the `emit` hook, return `verdict.value` when `verdict.code == "held"`, else `0.0`. The over-budget drop in `pump` keeps its `code == "over_budget"` branch from G1. `_wakes` recording and pruning stay in the scheduler.

- [ ] **Step 1: Write failing tests:** `test_wake_caps_allow_under_both_caps`; `test_wake_caps_hold_when_the_kind_cap_is_reached_with_wait_seconds`; `test_wake_caps_hold_when_the_overall_cap_is_reached`; `test_wake_caps_ignore_kinds_without_a_cap`; `test_wake_caps_wait_is_zero_after_the_window_ages_out`. Existing scheduler cap tests unchanged.
- [ ] **Step 2:** `uv run pytest tests/test_builtin_guards.py tests/test_scheduler.py -v`. Expect new FAIL.
- [ ] **Step 3:** Implement; `Session` registers `wake_caps(wakes_per_hour)` on `emit` after `daily_budget`.
- [ ] **Step 4:** `uv run pytest tests/test_scheduler.py tests/test_sessions.py tests/test_events.py`. Expect PASS.
- [ ] **Step 5:** Commit `refactor(brain): wake caps are a guard on emit (G2)`.

### Task 5: Locked-tool rule in the brain

**Files:**
- Modify: `brain/src/brain/builtin_guards.py` (`resolve_mode`), `brain/src/brain/toolbox.py:161-171` (`set_mode`), `brain/src/brain/side_check.py:71-110`
- Test: `brain/tests/test_toolbox.py`, `test_side_check.py`, `test_builtin_guards.py` (edit only the assertions that encoded "locked always asks")

**Interfaces:**
- `resolve_mode`: `self_asks` -> ask; stored `auto` or `ask` wins for locked tools too; a locked tool with nothing stored -> ask. (`default_mode` and `effect` never open a locked tool.)
- `Toolbox.set_mode`: drops the `spec.locked and mode == "auto"` refusal. `self_asks` refusal stays.
- `SideCheck.decide`: for `facts.locked`, the candidate list is the non-builtin preferences whose `tool` column equals `facts.tool`; with none, return None before any model call (the builtin default no longer matters). Non-locked asks are unchanged. The prompt for a locked ask lists only those candidates. A returned preference id outside the candidate list returns None.

- [ ] **Step 1: Write failing tests:** `test_locked_tool_asks_by_default`; `test_locked_tool_runs_without_ask_after_set_mode_auto`; `test_set_mode_auto_on_locked_tool_is_saved`; `test_locked_tool_asks_again_after_set_mode_ask`; `test_side_check_locked_without_a_naming_preference_makes_no_model_call` (general preference exists, builtin default deleted); `test_side_check_locked_with_general_preference_and_default_present_is_none`; `test_side_check_locked_approves_under_a_preference_naming_the_tool`; `test_side_check_locked_candidates_exclude_other_tools_preferences`; `test_side_check_locked_unknown_preference_id_is_none`; `test_always_button_stays_hidden_for_locked` (permission options are `["allow","deny"]`, from `asks.py:50`, unchanged). Edit the old `set_mode` refusal test to expect success.
- [ ] **Step 2:** `uv run pytest tests/test_toolbox.py tests/test_side_check.py tests/test_builtin_guards.py -v`. Expect new tests FAIL.
- [ ] **Step 3:** Implement as above. One end-to-end test through `Toolbox.run`: locked app tool, general preference, default deleted -> person is asked.
- [ ] **Step 4:** `uv run pytest` whole brain. Expect PASS.
- [ ] **Step 5:** Commit `feat(brain): a locked tool runs only after an explicit unlock (G2)`.

### Task 6: Home switch for locked tools, with a risk warning

**Files:**
- Modify: `bodies/ui/src/home/permissions-panel.tsx:63-91`, `bodies/ui/src/home/permissions-panel.test.tsx`; check `bodies/ui/src/test-support/fake-host-bridge.ts` and `bodies/desktop/src/main` for any place that refuses `locked` (the bridge `setPermission` is expected to need no change)
- Test: `bodies/ui/src/home/permissions-panel.test.tsx`

**Interfaces:**
- Consumes: `row.locked`, `bridge.setPermission(name, mode)`.
- Produces: for locked rows the switch is enabled (`fixed` no longer includes `row.locked`), the note reads "Risky action" instead of "Always asks", and switching Ask to Auto shows an inline warning with Confirm and Cancel before calling `setPermission`; switching Auto to Ask calls it at once. Warning wording is the builder's (plain words, says it is a risky action and Scout will no longer ask).

- [ ] **Step 1: Write failing tests:** `a locked row's switch is enabled`; `turning a locked tool to Auto shows a risk warning and does not call setPermission yet`; `confirming the warning calls setPermission with auto`; `cancelling the warning leaves the switch on Ask and calls nothing`; `turning a locked tool back to Ask needs no confirmation`; `a self-asks or offline row stays fixed`. Update the old "locked row is disabled" test.
- [ ] **Step 2:** `pnpm --filter @tagalong/ui test -- permissions-panel`. Expect FAIL.
- [ ] **Step 3:** Implement in the panel.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Expect PASS.
- [ ] **Step 5:** Docs (list above), then commit `feat(ui): unlock a locked tool on Home with a risk warning (G2)` and `docs(brain): ask chain and locked-tool rule (G2)`.

---

## Slice G3: Turn timeout, expert news while away, body text size

Branch `feat/g3-turn-timeout-expert-news`. About 450 changed lines, 3 tasks. PR title `feat(brain): turn timeout, expert news while away, text size (G3)`.

**Done when:** a stalled model ends the turn within the limit with a clear message (tiny limit, no real sleep); tests show the person is told when an expert finishes, asks, stalls or dies, including while offline; a large text part from a body is refused with `over_limit`; docs updated.

**Docs:** `docs/brain.md` (turn timeout in "What a turn does"; limits), `docs/settings-and-secrets.md` and `README.md` settings list (`TAGALONG_TURN_TIMEOUT_S`, default 300), `docs/experts.md` (what the person is told and when away), `docs/asks.md` (expert ask while nobody is online), `docs/testing/feature-test-guide.md` (by hand: `TAGALONG_TURN_TIMEOUT_S=5` with a model stub or a slow tool; close the body while an expert runs and reopen to hear the news).

### Task 1: Scout turn timeout

**Files:**
- Modify: `brain/src/brain/config.py` (const `DEFAULT_TURN_TIMEOUT_S = 300.0`, field `turn_timeout`, loader), `brain/src/brain/mind/turn.py` (`run_turn`), `brain/src/brain/sessions.py`, `brain/src/brain/main.py:46-60`
- Test: `brain/tests/test_config.py`, `brain/tests/test_turn.py`, `brain/tests/test_sessions.py`

**Interfaces:**
- Produces `Config.turn_timeout: float`; env `TAGALONG_TURN_TIMEOUT_S` (positive finite float, same validation style as `_expert_timeout`; bad value raises `ValueError` naming the variable).
- Produces `run_turn(..., turn_timeout: float | None = None)`; `None` means no limit so existing tests are unchanged; `Session(..., turn_timeout=DEFAULT_TURN_TIMEOUT_S)`.
- Behavior: the loop body runs inside `asyncio.timeout(turn_timeout)`. Time spent inside the tool batch (`await _run_tools(...)`) is added back with `Timeout.reschedule`, so a person's slow ask never eats the clock. On `TimeoutError`: log a warning, notify one `reply` delta with the message (builder's wording, plain words, says Scout took too long), close dangling tool_use via `_close_dangling_tool_use`, end with reason `error`. Contract unchanged.

- [ ] **Step 1: Write failing tests:** `test_config.py`: `test_turn_timeout_defaults_to_300`; `test_turn_timeout_from_env`; `test_turn_timeout_rejects_zero_negative_nan_and_text`. `test_turn.py`: `test_stalled_model_ends_the_turn_with_error_and_a_message` (fake model awaits forever, `turn_timeout=0.05`; reason `error`, exactly one `reply` with the message, one `reply.done`); `test_turn_timeout_leaves_history_valid` (a pending tool_use gets its result closed); `test_time_in_tools_does_not_count_toward_the_turn_timeout` (tool sleeps 3x the limit, turn still `done`); `test_no_timeout_when_none`. `test_sessions.py::test_session_passes_the_turn_timeout`.
- [ ] **Step 2:** `uv run pytest tests/test_config.py tests/test_turn.py tests/test_sessions.py -v`. Expect new FAIL.
- [ ] **Step 3:** Implement. Inspect how `run_turn` already handles `CancelledError` first and keep it intact; `asyncio.timeout`'s own cancellation must be told apart from a real cancel (catch `TimeoutError` outside the `with`).
- [ ] **Step 4:** Re-run; then `uv run pytest`.
- [ ] **Step 5:** Commit `feat(brain): a Scout turn that runs too long ends with a message (G3)`.

### Task 2: Verify and fix expert news while away

**Files:**
- Modify (only where a test finds a gap): `brain/src/brain/jobs.py:259-285` (`_question`), `brain/src/brain/asks.py:73-74`, `brain/src/brain/sessions.py:178-182`
- Test: `brain/tests/test_jobs.py`, `brain/tests/test_sessions.py`

**Interfaces:**
- Consumes: scheduler `job_ended` (batch 30 s) and `job_question` events; `Jobs.on_finished`; `unreported_jobs` on start.
- Rule to prove: for each of finished, stalled (expert run cap hit), died (process exits), asked a question, asked a permission, the person is told once, and when no body is online the news is held and told when one connects.

- [ ] **Step 1: Write failing characterization tests first** (they may pass already; a pass is a verified behavior, a fail is the gap to fix): `test_finished_job_is_told_when_the_person_returns`; `test_expert_that_hits_the_run_cap_ends_failed_and_is_told` (tiny `expert_timeout`); `test_expert_process_death_ends_failed_and_is_told`; `test_job_ended_while_the_brain_was_down_is_told_on_start`; `test_question_while_nobody_is_online_is_told_when_someone_returns`; `test_permission_while_nobody_is_online_is_told_when_someone_returns`; `test_news_is_told_once_not_twice`.
- [ ] **Step 2:** `uv run pytest tests/test_jobs.py tests/test_sessions.py -k "told or returns or cap" -v`. Note which fail.
- [ ] **Step 3:** Fix each failing one minimally. Expected gap: `Asks.open` returns `Answer(None)` at once offline, so `_question` and `_permission` answer nothing and no event is emitted. Fix by emitting the existing `job_question` event (keyed by job id) when an ask found nobody, so Scout mentions it on return. Do not add new event kinds or timeouts.
- [ ] **Step 4:** `uv run pytest tests/test_jobs.py tests/test_sessions.py tests/test_scheduler.py`. Expect PASS.
- [ ] **Step 5:** Commit `fix(brain): tell the person what an expert did while they were away (G3)`.

### Task 3: Count text parts in the body output size check

**Files:**
- Modify: `brain/src/brain/toolbox.py:115-121`
- Test: `brain/tests/test_toolbox.py`

**Interfaces:**
- Consumes: `LIMITS["part_bytes"]` (5 MB), `LIMITS["message_bytes"]` (20 MB), `TextPart.text` (`protocol.py:113`).
- Behavior: a part's size is `len(part.text.encode("utf-8"))` for text, the existing base64-decoded estimate for data parts. Same `over_limit` error and message.

- [ ] **Step 1: Write failing tests:** `test_body_text_part_over_part_limit_is_refused`; `test_body_many_text_parts_over_message_limit_are_refused`; `test_body_text_just_under_the_limit_passes`; `test_body_multibyte_text_counts_bytes_not_characters`.
- [ ] **Step 2:** `uv run pytest tests/test_toolbox.py -k "body_text or body_many or multibyte" -v`. Expect FAIL.
- [ ] **Step 3:** Implement in `BodySource.run`.
- [ ] **Step 4:** `uv run pytest`; checks.
- [ ] **Step 5:** Docs (list above), then commit `fix(brain): count text parts against body output limits (G3)` and `docs(brain): turn timeout and expert news (G3)`.

---

## Slice G4: Secrets

Branch `feat/g4-secrets`. About 800 changed lines, 4 tasks. PR title `feat(brain): keep app secrets out of the table and mask saves (G4)`.

**Done when:** a fake API key, bearer token and a `?token=` URL read `[secret]` in the saved chat, an approvals row, a stored job result and log output; the live turn and the tool still get the real values; an old app row is migrated, holds no secret afterwards, and still connects; docs updated.

**Docs:** `docs/connected-apps.md` and `docs/settings-and-secrets.md` (where app secrets live), `docs/privacy.md` ("What is masked on disk, what is not": live turn and side-check prompt are not), `docs/brain.md` (`save` hook), `docs/testing/feature-test-guide.md` (by hand: add an app with an env secret, inspect the apps table and `app-tokens.json`; paste a fake key in chat, read the saved chat and log), `README.md` if it lists privacy behavior.

### Task 1: App secrets move to the token file, with a migration

**Files:**
- Modify: `brain/src/brain/apps.py:99-135,153-190,236-300,440-470` (validation split, `TokenFile`, connect, startup migration), `brain/src/brain/memory.py:360-375` (`update_app_config(app_id, config)`)
- Test: `brain/tests/test_apps.py`, `brain/tests/test_memory.py`

**Interfaces:**
- Consumes: `TokenFile.get/set` (keys are strings; the existing app bearer token key stays the bare app id).
- Produces `TokenFile.set_many`-free helpers: `TokenFile.clear_app(app_id)` removing every key that equals the id or starts with `f"{app_id}:"`; `Apps.remove` uses it.
- Rule: for stdio apps, env entries whose value is a literal (not a `${VAR}` or `${VAR:-x}` reference) move to token key `f"{app_id}:env:{NAME}"`; the row keeps `config["env"]` with only the reference entries and gains `config["secret_env"]: list[str]` of moved names. For http apps, userinfo and query params whose lowercased name is in `SECRET_PARAMS = {"token","access_token","api_key","apikey","key","secret","password","auth","sig","signature"}` move as one query string to token key `f"{app_id}:url_query"`; the row URL keeps the rest and `config["url_secret"] = True`. At connect time the secrets are merged back (env merged into the expanded env; query appended to the URL). A missing token key raises `AppError(f"{row.name} needs its secret added again.")` in the same style as the existing token message.
- Produces `Apps.migrate_secrets() -> int` called once at startup (in `Apps.__init__` or `start`): rewrites every stored row that still holds a literal secret, idempotent, returns the count moved.

- [ ] **Step 1: Write failing tests:** `test_add_stdio_app_moves_literal_env_values_to_the_token_file`; `test_add_stdio_app_keeps_env_references_in_the_row`; `test_add_http_app_moves_secret_query_params_and_keeps_the_rest`; `test_add_http_app_moves_userinfo`; `test_connect_merges_env_secrets_back_in` (fake MCP server sees the real value); `test_connect_appends_the_url_query_back`; `test_remove_app_clears_every_secret_key_for_the_app`; `test_missing_secret_key_says_add_it_again`; `test_migration_rewrites_an_old_row_and_leaves_no_secret_in_the_table` (insert an old-shape row directly, run, read the raw SQLite row, assert no secret substring; app still connects); `test_migration_is_idempotent`. `test_memory.py::test_update_app_config_replaces_only_config`.
- [ ] **Step 2:** `uv run pytest tests/test_apps.py tests/test_memory.py -k "secret or migration or update_app_config" -v`. Expect FAIL.
- [ ] **Step 3:** Implement. Reuse `_check_stdio`/`_check_http` output, then split in one `_split_secrets(app_id, config, transport)` helper shared by add and migrate.
- [ ] **Step 4:** `uv run pytest tests/test_apps.py tests/test_app_tools.py tests/test_app_home_tools.py tests/test_app_oauth.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(brain): app env and url secrets live in the token file (G4)`.

### Task 2: `Masker` and the `mask_secrets` save guard

**Files:**
- Create: `brain/src/brain/masking.py`
- Modify: `brain/src/brain/builtin_guards.py` (register helper), `brain/src/brain/apps.py` (`Apps.secret_values() -> list[str]`)
- Test: `brain/tests/test_masking.py`

**Interfaces:**
- Produces `class Masker(values: Callable[[], Iterable[str]])` with `mask(text: str) -> str`. Exact values of length >= 8 are replaced longest first with `[secret]`; shapes also replaced: `sk-ant-[A-Za-z0-9_-]{20,}`, `Bearer\s+[A-Za-z0-9._~+/=-]{16,}` (keeps the word Bearer), `gh[pousr]_[A-Za-z0-9]{36,}`, `xox[abprs]-[A-Za-z0-9-]{10,}`, `AKIA[0-9A-Z]{16}`, and the value of `[?&](token|access_token|api_key|apikey|key|secret|password|sig|signature)=` up to `&`, whitespace or a quote (the parameter name stays).
- Produces `mask_secrets(masker: Masker) -> Guard` on `save`: returns `rewrite(masked)` when the text changed, else `ALLOW`. A raise follows the runner rule (block); callers store the placeholder `[withheld]` on a block.
- Produces `mask_json(guards: Guards, what: str, obj: Any) -> Any`, walking dicts, lists and strings and returning a masked copy (input never mutated); a block anywhere returns `"[withheld]"` for that string.
- Produces `Apps.secret_values()`: all TokenFile values plus OAuth access and refresh tokens read through `FileTokenStorage` for each app. The API key comes from `main.py` (`os.environ.get("ANTHROPIC_API_KEY")`) into the `values` callable, which skips empty entries.

- [ ] **Step 1: Write failing tests:** `test_masks_an_exact_value`; `test_ignores_values_shorter_than_eight_chars` ("abc" is not masked in "abc def"); `test_masks_longest_value_first` (one value contains another); `test_masks_each_key_shape` (one case per pattern above, fake values only); `test_url_token_keeps_param_name` (`https://x/y?token=abc12345&a=1` -> `?token=[secret]&a=1`); `test_clean_text_is_untouched_and_rewrite_not_returned`; `test_mask_json_walks_tool_use_input_and_tool_result_blocks`; `test_mask_json_does_not_mutate_the_original`; `test_save_guard_raising_withholds` (masker whose values callable raises -> `"[withheld]"`); `test_values_are_read_fresh_each_time` (a token added after construction is masked).
- [ ] **Step 2:** `uv run pytest tests/test_masking.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement. Compile the regexes once at module level; build the exact-value alternation per call from the callable.
- [ ] **Step 4:** Re-run; ruff.
- [ ] **Step 5:** Commit `feat(brain): mask secrets in text before it is saved (G4)`.

### Task 3: Apply the `save` hook to chat, approvals, job results and log lines

**Files:**
- Modify: `brain/src/brain/sessions.py:244-251` (chat save), `brain/src/brain/approvals.py:37-65` (`record`), `brain/src/brain/jobs.py:294-300` (`_end` result), `brain/src/brain/main.py` (build `Masker`, register `mask_secrets` on `save`, attach the log filter)
- Test: `brain/tests/test_sessions.py`, `test_approvals.py`, `test_jobs.py`, `test_main.py`

**Interfaces:**
- Consumes: T2 `Masker`, `mask_secrets`, `mask_json`; `Guards.run_sync(Hook.save, SaveCtx(what, text))`.
- Rules: the chat save writes a masked copy (`mask_json(guards, "chat", new_messages)`); `Session.history` and `_saved` are untouched, so the live turn keeps the real values. `Approvals.record` masks `summary` and `input` (`"approval"`). `Jobs._end` masks `result` (`"job_result"`). `class SecretLogFilter(logging.Filter)` in `masking.py` masks `record.getMessage()` then clears `record.args` and sets `record.msg`; attached to the root handler(s) in `main.py`. Optional `guards=None` keeps existing constructors unchanged (None means no masking). The runner does not log rewrites (see the logging constraint), which also prevents the log filter from recursing into itself.

- [ ] **Step 1: Write failing tests:** `test_sessions.py::test_saved_chat_has_secret_masked_but_history_keeps_it` (read the raw SQLite messages; real value absent, `[secret]` present; `session.history` still has the real value); `test_saved_chat_masks_tool_use_input_and_tool_result_text`; `test_resumed_history_shows_secret_placeholder`; `test_approvals.py::test_record_masks_summary_and_input`; `test_jobs.py::test_job_result_is_masked_in_the_row_and_reported_note`; `test_main.py::test_log_lines_are_masked` (a fake key and `?token=` URL logged at ERROR with an `exc_info` and a `%s` arg, handler output has `[secret]` only); `test_the_tool_still_receives_the_real_value` (fake app tool gets the real bearer token while the saved copy is masked); `test_masking_guard_failure_saves_withheld_not_raw`.
- [ ] **Step 2:** `uv run pytest tests/test_sessions.py tests/test_approvals.py tests/test_jobs.py tests/test_main.py -k "mask or secret or withheld or real_value" -v`. Expect FAIL.
- [ ] **Step 3:** Implement as above. The log filter formats once with the record's own args so `%`-style messages stay valid.
- [ ] **Step 4:** `uv run pytest` whole brain; checks.
- [ ] **Step 5:** Commit `feat(brain): saved chat, approvals, job results and logs hide secrets (G4)`.

### Task 4: Docs and final pass

**Files:** the G4 docs list above; `CLAUDE.md` Layout line (`masking.py`).

- [ ] **Step 1:** Write the docs; privacy page states plainly what is not masked (live turn, side-check prompt, the tool's own input).
- [ ] **Step 2:** `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; `pnpm format:check`. Expect PASS.
- [ ] **Step 3:** Commit `docs(brain): where secrets live and what is masked (G4)`.

---

## Self-review notes (spec coverage)

- Framework, verdicts, hooks, runner rules, log, config: G1 T1-T3. `tool_result` hook: defined in `Hook` and tested in the runner but no guard uses it (spec maps no existing check there); no task adds one.
- Mapping table: budget/step cap (G1), `tool_mode`, `anyone_online`, `side_check`, `person_ask`, expert relay, `wake_caps` (G2), app classifier and 8000-char fence stay as plumbing.
- Locked rule: G2 T5 (brain) and T6 (Home). Turn timeout, expert news, body text fix: G3. Secrets: G4.
- Non-goals respected: no Home guards page, no app input-schema validation, no new expert timeouts.
