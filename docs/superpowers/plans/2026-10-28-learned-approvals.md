# Learned approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every permission ask is saved with how it ended; Scout offers to take over a repeated kind of approval, saves the person's yes as a plain-sentence preference, and answers later matching asks under it, with every such approval visible on Home.

**Architecture:** A new `brain/src/brain/approvals.py` service records outcomes at the two code paths that ask (`Toolbox._ask` covers Scout, body and connected-app tools; `Jobs._permission` covers Claude Code). A standalone model call (the "side-check", the model of 10d's Scout-first question but not a session turn) decides approve-under-a-preference or pass. A second standalone look proposes offers after repeated person approvals. Home reads and edits through new Home tools over the existing `call` method; bodies show an Approvals page and a small report card.

**Tech Stack:** Python 3.12, SQLite (`memory.py` migrations), pytest-asyncio; TypeScript, React, Electron, zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-learned-approvals-design.md` (approved). Mockup: `.superpowers/brainstorm/56893-1793241461/content/approvals-home.html` (layout A plus the summary strip from B).

## Global Constraints

- Code decides *when* Scout looks; the model decides *if* a preference covers an ask. No rules engine, allowlists, command parsing or pattern matching in code.
- Side-check runs only if the person has at least one preference they created; the built-in risky-actions default does not count. With none: no wait, no model call, no cost.
- Scout's only outcomes are "approve under a named preference" or "pass". Deny is never Scout's call. Approving is allow-once only (Claude Code: the option whose kind is `allow_once`; never `allow_always`).
- Side-check timeout 20 s; errors, timeout, over-budget or nobody online mean the ask goes to the person as today. Spend counts toward `Budget`.
- Built-in default sentence: "Always ask me before risky actions". Seeded once by the migration, removable and editable. While it exists, code never lets Scout approve a `locked`/`confirm` tool (no model call at all); for Claude Code asks, risk is the model's judgment.
- Offer trigger: group = job folder for Claude Code, tool name for others; 3+ person approvals in 14 days; at most 1 look/offer per group per day; 7 days of silence after "Keep asking". The three numbers are settings (env, `config.py`).
- Offer options exactly `"Yes, auto-approve"` and `"Keep asking"`. A preference is saved only on the former.
- History rows record final outcome only (approved / refused / timed_out / no_one) and who decided (person / scout + preference id). A pass is not a row. History is never pruned.
- Today's per-tool Ask/Auto modes and the "Always" button are unchanged; "Always" is recorded as a person approval.
- Every new file opens with a 2-6 line header; comments say why. Conventional Commits, `type(scope): what (LA1)`. No Claude or AI attribution in commits, PRs, code or docs. Diagrams, if any, black-and-white Mermaid.
- Each slice ends with docs: `README.md`, the matching `docs/` files, `docs/testing/feature-test-guide.md`. Each slice PR 500-1,000 changed lines excluding lockfiles.

## Review Focus

- Scout approves something merely close to a preference, or approves a `locked` tool while the default exists (LA2 T1, T2).
- A preference saved without the explicit yes: offer ask times out, is cancelled, or answered "Keep asking" (LA2 T3).
- An approval Scout gave that is missing from the history, or a row with the wrong outcome: timeout, nobody online, "Always", Claude Code `reject_*` kinds (LA1 T2, T3; LA2 T2).
- Person with no preferences: any added latency, model call or budget spend (LA2 T1).
- Side-check hangs, throws, or answers with an unknown/builtin preference id (LA2 T1).
- Offer spam: repeated looks on every approval, offers for a group that already has a preference, two offers racing (LA2 T3).
- Removing a preference mid-flight: next matching ask must reach the person (LA2 T2).
- Brain offline or bodies old: Approvals page empty or failing quietly (LA3 T2).

## File Structure

| File | Responsibility |
| --- | --- |
| `brain/src/brain/memory.py` | migration (3 tables, default seed) and row methods |
| `brain/src/brain/approvals.py` | `Approvals` service (record, preferences, notify), Home tools |
| `brain/src/brain/side_check.py` | LA2: the standalone decision call and its two tools |
| `brain/src/brain/offers.py` | LA2: offer trigger, caps, look, offer ask |
| `brain/src/brain/mind/approvals.md` | LA2: wording for the decision and the offer look |
| `bodies/ui/src/home/approvals-view.tsx` (+ `preferences-list.tsx`, `approval-history.tsx`) | LA3: the page |

---

## Slice LA1: History, preferences, recording, Home calls, contract

Target about 800 changed lines. New: `approvals.py`, `tests/test_approvals.py`. Modified: `memory.py`, `toolbox.py`, `jobs.py`, `app_tools.py`, `sessions.py`, `protocol.py`, `protocol/ts/src/messages.ts` (+ test), `protocol/README.md`, docs. Home methods are Home tools over `call` (no new JSON-RPC method), as `list_jobs` is.

### Task 1: Tables and Memory methods

**Files:** modify `brain/src/brain/memory.py` (append one migration, new dataclasses and methods); test `brain/tests/test_memory.py`.

**Interfaces:**
- Produces tables: `approvals(id INTEGER PK, source TEXT CHECK IN ('scout_tool','claude_code','app'), tool, summary, input TEXT json, job_id, group_key, outcome TEXT CHECK IN ('approved','refused','timed_out','no_one'), decided_by TEXT CHECK IN ('person','scout','none'), preference_id INTEGER, at TEXT)`; `preferences(id INTEGER PK, sentence, source, tool, group_key, builtin INTEGER, created_at, use_count INTEGER DEFAULT 0, last_used TEXT)`; `offers(id INTEGER PK, group_key, at TEXT, outcome TEXT CHECK IN ('yes','keep_asking','no_answer','none'))`.
- Produces `@dataclass(frozen=True) Approval(id, source, tool, summary, input, job_id, group_key, outcome, decided_by, preference_id, at)` and `Preference(id, sentence, source, tool, group_key, builtin, created_at, use_count, last_used)`.
- Produces `Memory.add_approval(*, source, tool, summary, input, job_id, group_key, outcome, decided_by, preference_id, at) -> int`; `list_approvals(filter: Literal["all","scout","refused"], limit: int, before: int | None) -> list[Approval]` (newest first, `before` = id cursor); `approval_counts() -> dict[str,int]` keys `total, scout, refused`; `add_preference(*, sentence, source, tool, group_key, at) -> Preference`; `list_preferences() -> list[Preference]` (default first, then oldest first); `remove_preference(id) -> bool`; `edit_preference(id, sentence) -> bool`; `use_preference(id, at) -> None`; `add_offer(group_key, at, outcome) -> None`; `offers_for(group_key) -> list[tuple[str,str]]` (at, outcome, newest first); `person_approvals_since(group_key, since_iso) -> int`; `has_user_preferences() -> bool`; `has_preference_for(group_key) -> bool`; `default_preference() -> Preference | None`.

- [ ] **Step 1: Write failing tests** in `test_memory.py`: `test_fresh_db_has_only_the_risky_default` (one preference, `builtin` true, sentence "Always ask me before risky actions", `has_user_preferences()` false); `test_default_is_not_reseeded_after_removal` (remove, reopen the db, list empty); `test_list_approvals_filters` (rows approved-by-person, approved-by-scout, refused: `scout` returns only the scout row, `refused` only the refused one, `all` all three; `before` cursor pages); `test_approval_counts` (`total=3, scout=1, refused=1`); `test_person_approvals_since_counts_only_person_approved_in_group`; `test_use_preference_bumps_count_and_last_used`; `test_edit_and_remove_report_missing_ids` (False for unknown id); `test_migration_is_one_step_after_timers` (`PRAGMA user_version` rises by 1).
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_memory.py -k "default or approval or preference" -v`. Expect FAIL (no such method).
- [ ] **Step 3:** Implement the migration and the signatures above in `memory.py`; the default row is `INSERT`ed inside the migration so it exists exactly once.
- [ ] **Step 4:** Re-run; expect PASS. Then `uv run pytest tests/test_memory.py`.
- [ ] **Step 5:** Commit `feat(brain): store approvals and preferences (LA1)`.

### Task 2: Approvals service and recording at the tool gate

**Files:** create `brain/src/brain/approvals.py`; modify `toolbox.py`, `app_tools.py`, `sessions.py`; test `brain/tests/test_approvals.py`, `test_toolbox.py`.

**Interfaces:**
- Consumes: Task 1 Memory methods; `Source` classes in `toolbox.py`.
- Produces `Approvals(memory: Memory, notify: Callable[[str, dict], None], now: Callable[[], datetime])` with `record(*, source, tool, summary, input, group_key, outcome, job_id=None, decided_by="person", preference_id=None) -> None` (stores the row, then `notify("changed", {"what": "approvals"})`) and `summarise(text: str, tool: str, input: dict) -> str` (the ask text if non-empty, else `tool` plus compact input; cut at 200 chars, deterministic).
- Produces class attribute `approval_source: str` on `BrainSource` and `BodySource` (`"scout_tool"`) and `AppSource` (`"app"`).
- Produces `Toolbox(..., approvals: Approvals | None = None)`; `Toolbox._ask(call, spec, source_kind)` records exactly one row per ask. `group_key` is `spec.name`.

- [ ] **Step 1: Write failing tests.** `test_approvals.py`: `test_summarise_prefers_ask_text_and_cuts_at_200`; `test_record_notifies_changed_approvals`. `test_toolbox.py` (fake Asks): `test_allow_records_approved_by_person`; `test_always_records_approved_and_sets_auto`; `test_deny_records_refused_and_still_raises_denied`; `test_timeout_records_timed_out_and_reraises`; `test_nobody_online_records_no_one`; `test_app_tool_row_has_source_app`; `test_auto_tool_records_nothing`; `test_toolbox_without_approvals_behaves_as_before`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_approvals.py tests/test_toolbox.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement `Approvals.record/summarise`, the `approval_source` attributes, and the `_ask` wrapping (try/except around `self._asks.permission`; keep every existing raise and message). `Session.__init__` builds `Approvals(memory, notify, now)` before `Toolbox` and passes it.
- [ ] **Step 4:** Run the same command; expect PASS, then `uv run pytest` for the whole brain.
- [ ] **Step 5:** Commit `feat(brain): record every tool-gate ask and its outcome (LA1)`.

### Task 3: Record Claude Code permission asks

**Files:** modify `brain/src/brain/jobs.py`, `sessions.py`; test `brain/tests/test_jobs.py`.

**Interfaces:**
- Consumes: `Approvals.record`; `PermissionOption.kind` (ACP kinds `allow_once`, `allow_always`, `reject_once`, `reject_always`).
- Produces `Jobs(..., approvals: Approvals | None = None)`; `_permission` records `source="claude_code"`, `tool=f"claude_code:{request.title}"`, `group_key=f"claude_code:{folder}"` (folder from the job row), `job_id`.

- [ ] **Step 1: Write failing tests:** `test_permission_allow_kinds_record_approved` (a chosen `allow_once` and `allow_always` option both give `approved`); `test_permission_reject_kinds_record_refused` (display names deliberately odd, e.g. "Nope"); `test_permission_no_answer_records_timed_out`; `test_permission_nobody_online_records_no_one`; `test_group_key_is_the_job_folder_for_every_title`; `test_jobs_without_approvals_unchanged`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_jobs.py -k permission -v`. Expect FAIL.
- [ ] **Step 3:** Implement in `_permission`: map answer option to kind through `request.options`, decide `no_one` with `self._asks.anyone_online()` checked before opening the ask. Return values unchanged.
- [ ] **Step 4:** Run; expect PASS, then `uv run pytest tests/test_jobs.py`.
- [ ] **Step 5:** Commit `feat(brain): record Claude Code permission asks (LA1)`.

### Task 4: Home tools and contract

**Files:** modify `approvals.py` (add `approval_home_tools`), `sessions.py` (register), `brain/src/brain/protocol.py`, `protocol/ts/src/messages.ts`, `protocol/ts/src/messages.test.ts`, `brain/tests/test_protocol.py`, `protocol/README.md`; test `brain/tests/test_approvals.py`.

**Interfaces:**
- Produces `approval_home_tools(approvals: Approvals) -> list[tuple[ToolSpec, Handler]]`, audience `{"home"}`:
  - `list_approvals` input `{filter?: "all"|"scout"|"refused", before?: int}`; output JSON `{"approvals": [row...], "counts": {"total","scout","refused"}, "next": int|null}`; page size 50; `counts` ignore the filter and cover all history. Row keys snake_case: `id, source, tool, summary, input, job_id, outcome, decided_by, preference_id, preference (sentence or null), at`.
  - `list_preferences` output `{"preferences": [{id, sentence, source, tool, builtin, created_at, use_count, last_used}]}`.
  - `remove_preference {id}` and `edit_preference {id, sentence}` (sentence 1-300 chars after strip); both send `changed: approvals`; unknown id raises `RpcError(invalid_params)`.
- Produces contract notification `approved`: params `{seq, tool, text, preference}` (strings; `preference` is the sentence). Added to `BRAIN_TO_BODY` as `ApprovedParams`, to `brainToBody` in zod, and the `changed` text in `protocol/README.md` gains `approvals`; the `hello` Home-tools list gains the four tools; a new bullet documents `approved` (LA2 sends it).

- [ ] **Step 1: Write failing tests:** `test_list_approvals_returns_counts_and_cursor`; `test_list_approvals_scout_filter_includes_preference_sentence`; `test_remove_preference_changes_and_notifies`; `test_remove_default_is_allowed`; `test_edit_preference_rejects_empty_and_overlong`; `test_unknown_preference_id_is_invalid_params`; `test_home_tools_not_offered_to_the_model`. `test_protocol.py`: `test_approved_notification_shape` (extra keys rejected, missing `preference` rejected). `messages.test.ts`: `accepts an approved notification` / `rejects an approved notification without a preference`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_approvals.py tests/test_protocol.py -v` and `pnpm --filter @tagalong/contract test`. Expect FAIL.
- [ ] **Step 3:** Implement the tools, the pydantic `ApprovedParams` and zod `ApprovedParams`, and register in `Session` beside `app_home_tools`. Update `protocol/README.md` and, since contract examples are shared, add `protocol/examples/approved.json` if the examples folder lists every notification.
- [ ] **Step 4:** Run both commands; expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check` and `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`.
- [ ] **Step 5:** Commit `feat(brain): approvals history and preferences for Home (LA1)`.

### Task 5: Docs (LA1)

**Files:** `README.md`, `docs/brain.md`, `docs/asks.md`, `docs/protocol.md`, `docs/testing/feature-test-guide.md`.

- [ ] **Step 1:** Document the tables, recording points, Home tools, `approved` notification and `changed: approvals`. Feature-test-guide: a section "Approvals history (real brain)": approve, refuse and let one time out a Scout tool ask and a Claude Code ask; expected rows via `list_approvals`; default preference present.
- [ ] **Step 2:** Commit `docs: approvals history and Home calls (LA1)`. PR title `feat(brain): approvals history and preferences (LA1)`.

---

## Slice LA2: Side-check, offers, report notification

Target about 900 changed lines. New: `side_check.py`, `offers.py`, `mind/approvals.md`, `tests/test_side_check.py`, `tests/test_offers.py`. Modified: `toolbox.py`, `jobs.py`, `sessions.py`, `config.py`, `approvals.py`, docs. Needs LA1 merged.

### Task 1: SideCheck

**Files:** create `brain/src/brain/side_check.py`, `brain/src/brain/mind/approvals.md`; test `brain/tests/test_side_check.py`.

**Interfaces:**
- Consumes: `Model` (`brain.mind.turn`; read the stream to its `Final`, read the first `tool_use` block), `Budget.allows/spend`, Memory preference methods.
- Produces `@dataclass(frozen=True) AskFacts(source: str, tool: str, summary: str, input: dict, group_key: str, locked: bool)`.
- Produces `SideCheck(model: Model, budget, memory: Memory, timeout: float = 20.0)` with `async decide(facts: AskFacts) -> Preference | None` (the preference Scout approved under, else None).
- Model tools: `approve_under_preference(preference: int, reason: str)` and `pass_to_person()`. The prompt (`## decide` section of `mind/approvals.md`) lists the person's preferences with ids, the ask, and the last 10 history rows for the same tool/group; says "approve only when a preference clearly covers it; when unsure pass".

- [ ] **Step 1: Write failing tests** (fake `Model` returning a scripted `Final`): `test_no_user_preference_means_no_model_call` (model call count 0, returns None); `test_approve_returns_the_named_preference`; `test_pass_returns_none`; `test_unknown_preference_id_is_a_pass`; `test_builtin_default_cannot_be_approved_under`; `test_locked_tool_with_default_present_skips_the_model` (count 0); `test_locked_tool_after_default_removed_may_be_approved`; `test_model_error_is_a_pass`; `test_timeout_is_a_pass` (model sleeps past a 0.05 s timeout); `test_over_budget_skips_the_model`; `test_usage_is_spent_on_the_budget`; `test_no_tool_use_block_is_a_pass`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_side_check.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement `decide`; `asyncio.timeout(self._timeout)` around the stream; code enforcement order: user-preference check, locked-plus-default check, budget check, model, validate id (exists, not builtin).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(brain): scout side-check decides under a preference (LA2)`.

### Task 2: Use the side-check at both ask points, report it

**Files:** modify `toolbox.py`, `jobs.py`, `approvals.py`, `sessions.py`; test `test_toolbox.py`, `test_jobs.py`.

**Interfaces:**
- Consumes: `SideCheck.decide`, `Approvals.record`, `Memory.use_preference`.
- Produces `Approvals.scout_approved(facts: AskFacts, pref: Preference, summary: str, job_id: str | None = None) -> None`: records `approved`/`decided_by="scout"`/`preference_id`, calls `use_preference`, sends `notify("approved", {"tool": facts.tool, "text": summary, "preference": pref.sentence})`.
- Produces `Toolbox(..., side_check: SideCheck | None = None)` and `Jobs(..., side_check: SideCheck | None = None)`.

- [ ] **Step 1: Write failing tests:** `test_scout_approval_runs_the_tool_without_asking_the_person` (Asks never opened); `test_scout_approval_row_and_notification`; `test_pass_falls_through_to_the_person_ask`; `test_allow_always_is_never_used_for_scout` (tool stays in ask mode); `test_claude_code_approval_returns_the_allow_once_option_id`; `test_claude_code_without_allow_once_option_passes`; `test_removed_preference_sends_next_ask_to_the_person`; `test_no_one_online_skips_side_check`; `test_side_check_runs_while_a_turn_is_running` (concurrent, no session-history change).
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_toolbox.py tests/test_jobs.py -k "scout or side or allow_once" -v`. Expect FAIL.
- [ ] **Step 3:** In `Toolbox._ask` and `Jobs._permission`, call `side_check.decide` after the online check and before opening the ask; on a preference, call `scout_approved` and return as allowed. Build `SideCheck(self._model, budget, memory)` in `Session`.
- [ ] **Step 4:** Run; expect PASS; then `uv run pytest`.
- [ ] **Step 5:** Commit `feat(brain): scout answers asks under a preference and reports it (LA2)`.

### Task 3: Offers

**Files:** create `brain/src/brain/offers.py`; modify `config.py`, `mind/approvals.md` (`## offer`), `toolbox.py`, `jobs.py`, `sessions.py`; test `brain/tests/test_offers.py`, `test_config.py`.

**Interfaces:**
- Consumes: `Memory.person_approvals_since/offers_for/has_preference_for/add_offer/add_preference`, `Asks.open`, `Model`, `Budget`.
- Produces `Config.offer_min_approvals=3`, `offer_window_days=14`, `keep_asking_days=7` from `TAGALONG_OFFER_MIN_APPROVALS`, `TAGALONG_OFFER_WINDOW_DAYS`, `TAGALONG_KEEP_ASKING_DAYS` (positive ints, same error style as `TAGALONG_WAKES_PER_HOUR`).
- Produces `OfferSettings(min_approvals, window_days, keep_asking_days)` and `Offers(model, budget, memory, asks, notify, settings, now)` with `consider(group_key: str, source: str, tool: str) -> None`, called after a person approval (fire and forget; the task is kept in a set so it is not collected). Conditions in order: anyone online; no person preference for the group; last offer/look older than 1 day; no `keep_asking` within `keep_asking_days`; `person_approvals_since(window) >= min_approvals`; budget allows. Then one look (model tools `offer(sentence: str)` and `no_offer()`), recorded as an `offers` row (`none` when no offer, so a look is capped to 1/day). On `offer`: `Asks.open(text=<lead naming the group, count and the proposed sentence>, options=["Yes, auto-approve","Keep asking"], tool="approval_offer", input={"sentence": sentence, "group": group_key}, timeout=600)`; yes saves the preference (source, tool, group) and sends `changed: approvals`; Keep asking records `keep_asking`; timeout, cancel or error records `no_answer` and saves nothing.

- [ ] **Step 1: Write failing tests:** `test_three_person_approvals_in_window_trigger_one_look`; `test_two_approvals_do_not`; `test_scout_approvals_do_not_count`; `test_approvals_older_than_window_do_not_count`; `test_claude_code_group_counts_across_different_titles` (same folder); `test_no_offer_still_caps_looks_to_one_per_day`; `test_keep_asking_blocks_for_seven_days_then_allows`; `test_group_with_a_preference_is_never_offered`; `test_yes_saves_the_preference_with_source_tool_group`; `test_keep_asking_saves_nothing`; `test_ask_timeout_saves_nothing_and_records_no_answer`; `test_nobody_online_or_over_budget_skips`; `test_offer_text_names_the_sentence`; `test_two_concurrent_considers_make_one_offer`; config tests for the three settings (defaults, bad value error).
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_offers.py tests/test_config.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement `Offers`; guard concurrency with a per-group in-flight set. Call `consider` from `Toolbox._ask` (after a person's `allow`/`always`) and `Jobs._permission` (person chose an `allow_*` option).
- [ ] **Step 4:** Run; expect PASS; then full brain suite, `uv run ruff check`, `uv run ruff format --check`.
- [ ] **Step 5:** Commit `feat(brain): scout offers to auto-approve a repeated kind of ask (LA2)`.

### Task 4: Docs (LA2)

**Files:** `README.md`, `docs/brain.md`, `docs/asks.md`, `docs/mind.md`, `docs/protocol.md`, `docs/testing/feature-test-guide.md`, `brain/.env.example` if the repo lists settings there.

- [ ] **Step 1:** Document the side-check order, offer rules, the three env settings, the `approved` notification now being sent. Feature-test-guide "Learned approvals (real brain, real Claude Code)": approve three git commands in one folder, expect the offer; Yes, then a fourth command is approved by Scout with a report and a history row; Remove the preference, next ask comes to you; Keep asking, no offer for 7 days; locked tool still asks while the default exists.
- [ ] **Step 2:** Commit `docs: side-check and offers (LA2)`. PR title `feat(brain): scout approves under preferences and offers them (LA2)`.

---

## Slice LA3: Approvals page, report card, offer card

Target about 750 changed lines. New: `bodies/ui/src/home/approvals-view.tsx`, `preferences-list.tsx`, `approval-history.tsx` (+ tests), `bodies/desktop/src/main/ipc/approvals.ts`, `bodies/desktop/e2e/approvals.spec.ts`. Modified: `host-bridge.ts`, `test-support/fake-host-bridge.ts`, `home-view.tsx`, `home-styles.ts`, `companion-bubble.tsx`, `bodies/desktop` (`ipc.ts`, preload, main `index.ts`), `e2e/fixtures/fake-brain.ts`, docs. Needs LA1 and LA2 merged.

### Task 1: Bridge and desktop IPC

**Files:** modify `bodies/ui/src/host-bridge.ts`, `test-support/fake-host-bridge.ts`, `bodies/desktop/src/shared/ipc.ts`, `src/preload/index.ts`; create `bodies/desktop/src/main/ipc/approvals.ts` and register it in `main/index.ts`; test `ipc/approvals.test.ts`.

**Interfaces:**
- Produces types `ApprovalRow {id:number; source:'scout_tool'|'claude_code'|'app'; tool:string; summary:string; outcome:'approved'|'refused'|'timed_out'|'no_one'; decidedBy:'person'|'scout'|'none'; preference:string|null; at:string}`, `ApprovalCounts {total:number; scout:number; refused:number}`, `PreferenceRow {id:number; sentence:string; builtin:boolean; createdAt:string; useCount:number; lastUsed:string|null}`.
- Produces optional bridge methods `listApprovals?(filter:'all'|'scout'|'refused', before?:number): Promise<{approvals:ApprovalRow[]; counts:ApprovalCounts; next:number|null}>`, `listPreferences?(): Promise<PreferenceRow[]>`, `removePreference?(id:number): Promise<void>`, `editPreference?(id:number, sentence:string): Promise<void>`, and `onApproved?(handler:(n:{tool:string; text:string; preference:string})=>void): () => void`. Handlers call the Home tools `list_approvals`, `list_preferences`, `remove_preference`, `edit_preference` through `callJson` and map snake_case to camelCase, as `ipc/jobs.ts` does.

- [ ] **Step 1: Write failing tests:** `maps a brain approvals row to camelCase`; `rejects a bad payload`; `rejects a non-numeric preference id before calling the brain`; `edit sends id and sentence`.
- [ ] **Step 2:** `pnpm --filter @tagalong/desktop test -- approvals`. Expect FAIL.
- [ ] **Step 3:** Implement the handlers, IPC channel names (`tagalong:approvals:list`, `...:preferences:list|remove|edit`, `tagalong:approved-event`), preload methods, and forward the `approved` brain notification from `main/index.ts` the way `changed` is forwarded. Add fake-bridge counterparts with call recorders.
- [ ] **Step 4:** Run; expect PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(desktop): approvals through the bridge (LA3)`.

### Task 2: Approvals page on Home

**Files:** create `approvals-view.tsx`, `preferences-list.tsx`, `approval-history.tsx` and tests in `bodies/ui/src/home/`; modify `home-view.tsx` (add `'approvals'` to `HomePage` and `PAGES`, after Connections; update the page-count comment) and `home-styles.ts`.

**Interfaces:**
- Consumes: bridge methods from Task 1; `onBrainChanged` (`what === 'approvals'` refetches).
- Produces `ApprovalsView()` (no props) showing: title and sub-line; "Standing preferences" cards (sentence, agreed date, used N times, last used, Remove; Edit inline with Save/Cancel; the built-in default shown like any other); the summary strip (`total` asks, `scout` "Scout answered", `refused` "refused") above the history; segmented filter "All / Decided by Scout / Refused" with counts, `aria-pressed`; history grouped by day (Today, Yesterday, date) with time, source icon and label, summary, outcome chip (Approved / Refused / Timed out / No one online), and for Scout-decided rows the navy rail, "Scout decided, per your preference" plus the sentence, and an "Auto" pill; "Show more" using `next`. No nav badge.

- [ ] **Step 1: Write failing tests** (vitest, fake bridge): `lists preferences with the default first and Remove on every card`; `Remove calls removePreference then refetches`; `editing saves the new sentence and rejects an empty one in the form`; `summary strip shows the counts from the brain`; `filter buttons call listApprovals with the filter and mark aria-pressed`; `a scout row shows the sentence it relied on`; `a refused row and a timed out row get their chips`; `rows group under Today and Yesterday`; `empty history says nothing here yet`; `a changed approvals notice refetches`; `a failed read shows an alert and keeps the page`; `renders nothing when the bridge has no listApprovals`; `home nav has an Approvals item that opens the page`.
- [ ] **Step 2:** `pnpm --filter @tagalong/ui test -- approvals home-view`. Expect FAIL.
- [ ] **Step 3:** Implement the components, following `jobs-panel.tsx` for fetch/refetch/failure handling and the mockup's layout A classes translated into `home-styles.ts` tokens (check `home-styles.test.ts` for any token rule). Day grouping uses local time.
- [ ] **Step 4:** Run; expect PASS; `pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5:** Commit `feat(ui): Approvals page on Home (LA3)`.

### Task 3: Report card and offer card

**Files:** modify `bodies/ui/src/companion-bubble.tsx` (+ `companion-bubble.test.tsx`), bubble event wiring in the desktop renderer host.

**Interfaces:**
- Consumes: `bridge.onApproved`.
- Produces a small card "Approved for you: {text}" with the line "per '{preference}'" that fades with the bubble's normal notice timing; no Scout speech. The offer is an existing custom-option ask (`tool: "approval_offer"`, text from the brain, options "Yes, auto-approve" / "Keep asking"); no new ask component. The richer labelled-row offer from the mockup is not built here.

- [ ] **Step 1: Write failing tests:** `shows an approved-for-you card with the preference sentence`; `the report card does not open the composer or start a turn`; `an approval_offer ask renders its text and exactly two buttons and answering sends the chosen option`.
- [ ] **Step 2:** `pnpm --filter @tagalong/ui test -- companion-bubble`. Expect FAIL on the first two (the third may already pass; keep it as a pin).
- [ ] **Step 3:** Implement the card, mirroring how the hand-off notice is surfaced.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(ui): report card for approvals Scout gave (LA3)`.

### Task 4: E2E on the fake brain, docs

**Files:** create `bodies/desktop/e2e/approvals.spec.ts`; modify `e2e/fixtures/fake-brain.ts` (answer the four Home tools, accept `remove_preference`, send `approved` and `changed: approvals`), `README.md`, `docs/desktop.md`, `docs/bubble.md`, `docs/brain.md` (cross-link), `docs/testing/feature-test-guide.md`.

- [ ] **Step 1: Write the spec** (Playwright Electron, pattern of `jobs.spec.ts`): `approvals page shows preferences, counts and history`; `removing a preference updates the list`; `a Scout-decided row is marked and the Scout filter shows only it`; `an approved notice shows the report card`; `an offer ask is answered with Yes, auto-approve`.
- [ ] **Step 2:** `pnpm --filter @tagalong/desktop test:e2e -- approvals`. Expect FAIL before the fixture is extended.
- [ ] **Step 3:** Extend the fake brain until the spec passes; update docs (page contents, report card, how to test by hand with the real brain: the LA2 guide section plus checking the page).
- [ ] **Step 4:** Run the e2e command; expect PASS. Then `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5:** Commit `test(desktop): approvals e2e on the fake brain (LA3)`. PR title `feat(ui): approvals page, report card and offer on Home (LA3)`.

---

## Self-review

- **Spec coverage:** history from all three sources (LA1 T2, T3; apps via `AppSource` in T2); preferences and default (T1); Home calls, three filters, edit/remove, `changed`, report notification contract (T4); side-check rules, allow-once, 20 s, budget, locked block (LA2 T1, T2); offers, groups, caps, settings, yes saves (LA2 T3); report (LA2 T2); Approvals page, summary strip, report card, offer card (LA3). Non-goals respected: no matching code, no automatic preferences.
- **Types:** `AskFacts`, `Preference`, `Approvals.record/scout_approved`, `Offers.consider`, and bridge row types are named once and reused identically.
- **Review Focus:** each line maps to a named test above.

## Gaps found in the spec and how this plan resolves them

- The three ask points are two code paths: connected-app tools run through `Toolbox._ask` like Scout's own tools. One `approval_source` attribute tells them apart.
- "Contract methods" for Home are Home tools over `call`; the only new wire item is the `approved` notification.
- A look that finds nothing to offer would repeat on every approval; every look is saved as an `offers` row so the 1-per-day cap bounds cost.
- After "Yes", more approvals in the same group would be re-offered; groups that already have a preference are skipped.
- The default must not return after removal: seeded once inside the migration.
- Summary-strip counts are all-time (history is never pruned) and ignore the active filter; the mockup's "in 2 days" wording is dropped.
- Offer text lives in `mind/approvals.md`, not in code.

## Execution handoff

Slices are sequential (LA2 needs LA1's service and tables; LA3 needs both). Inside a slice, tasks depend on each other's interfaces, so subagent-driven with a fresh reviewer per task is recommended for LA1 and LA2; LA3 can run native.
