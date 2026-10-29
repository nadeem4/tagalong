# Row 9: Connected apps (MCP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Scout can use tools from MCP servers the person connects, behind the same permission gate as every other tool.

**Architecture:** The brain is an MCP client (official `mcp` Python SDK). `brain/src/brain/apps.py` keeps one long-lived asyncio task per app; a third toolbox source (`AppSource`) exposes `appid__tool`. Home manages apps through `call` methods; the Connections page and desktop IPC move from the old core to those calls.

**Tech Stack:** Python 3.12, `mcp` (pinned), SQLite, pytest-asyncio; TypeScript, React, Electron, vitest.

**Spec:** approved design in the row 9 Notion plan; `docs/connected-apps.md` is the old TS design.

## Global Constraints

- Transports: stdio (command/args/env) and Streamable HTTP (https, or http to localhost). No SSE.
- No secrets in `apps` rows. stdio env values may be `${VAR}` / `${VAR:-default}` from the brain's environment/.env. Tokens and OAuth state live in the data dir (TAGALONG_HOME).
- Tool name `appid__tool` (`SEP = "__"`), max 64 chars (`NAME_MAX`). App id `^[a-z0-9][a-z0-9-]{0,23}$`, from the name, `-2`/`-3` on clash, never a body id.
- Connect in the background at brain start, 30 s timeout; a failing app never blocks boot or another app. Manual restart only.
- Results cut at 8,000 chars, fenced as app data. Errors are one plain line.
- Out of scope: resources, prompts, sampling, elicitation, deferred tool loading, catalog, Claude Code config import.
- Every new file opens with a 2-6 line header; comments say why. No Claude attribution anywhere.
- Each slice ends with docs: README.md, docs/brain.md, docs/connected-apps.md, docs/testing/feature-test-guide.md.

## Review Focus

- App hangs or exits at connect; Windows `.cmd` shims and orphan child processes (9a T3).
- Tool names over 64 chars or colliding; tools with no hints or a `delete_all` hinted read-only (9a T2).
- Result text that closes the `<data>` fence or floods context (9a T4).
- Secrets in rows, logs or errors (9a T1, 9c T1).
- OAuth: non-https URL, second callback, user never finishes (9c T2).
- Brain offline while Home shows apps (9b T2).

## Verified SDK facts (9a T0, mcp==2.3.0) — these override any older names below

`streamable_http_client(url, *, http_client=...)` yields `(read, write)` only; headers and auth go on an httpx2 client from `create_mcp_http_client(headers=, timeout=, auth=)`. `Tool.annotations` may be None; fields are `read_only_hint` / `destructive_hint`. `message_handler` receives the notification object itself (e.g. `ToolListChangedNotification`). OAuth `callback_handler` returns `AuthorizationCodeResult(code, state, iss)`; `OAuthClientProvider` is an `httpx2.Auth`. Full list: the 9a task-0 report in the SDD workspace and `brain/tests/test_sdk_smoke.py`.

## Unverified SDK facts (original guesses)

The planning session could not reach the web, so the version and names below are from memory; 9a T0 confirms them. `mcp` on PyPI (pin the newest release at least two weeks old); `mcp.ClientSession(read, write, message_handler=...)`; `mcp.client.stdio` (`stdio_client`, `StdioServerParameters`, `get_default_environment`); `mcp.client.streamable_http.streamablehttp_client(url, headers=, auth=)` yielding `(read, write, get_session_id)` (may be renamed); `initialize`, `list_tools`, `call_tool`; `Tool.annotations.readOnlyHint/destructiveHint`; `ToolListChangedNotification`; `mcp.client.auth` (`OAuthClientProvider`, `TokenStorage`, `OAuthClientMetadata`).

---

# Slice 9a: Brain manager, store, stdio and HTTP (token/none), toolbox source, Home calls

New under `brain/`: `src/brain/apps.py`, `app_tools.py`, `tests/fake_mcp_server.py`, `test_apps.py`, `test_app_tools.py`. Modified: `pyproject.toml`, `memory.py`, `toolbox.py`, `sessions.py`, `tools.py`, `main.py`.

### Task 0: Pin the SDK, prove the names

**Files:** `brain/pyproject.toml`, `brain/tests/test_sdk_smoke.py`.

- [ ] **Step 1:** Look up the newest eligible `mcp` release on PyPI; add `"mcp==X.Y.Z"`; `cd brain && uv sync`.
- [ ] **Step 2:** Write `test_sdk_imports` importing every name in the list above and checking the HTTP client's parameters. Run `uv run pytest tests/test_sdk_smoke.py`; fix names (and this plan) until green.
- [ ] **Step 3:** Commit `chore(brain): pin the mcp sdk (9a)`.

### Task 1: `apps` table and store

**Files:** `memory.py` (append one migration), `apps.py` (store part), tests `test_memory.py`, `test_apps.py`.

**Interfaces:** table `apps(id PRIMARY KEY, name, transport CHECK IN ('stdio','http'), config JSON text, auth CHECK IN ('none','token','oauth'), enabled INTEGER)`; `Memory.list_apps/add_app/set_app_enabled/remove_app`; `AppRow` dataclass; `slug_for(name, taken) -> str`; `expand_env(value, env) -> str`; `validate_app(params) -> AppRow`, raising `AppError` (plain line).

- [ ] **Step 1: Failing tests:** `test_migration_adds_apps`; `test_slug_clash` (`linear-2`, `-3`); `test_slug_avoids_body_ids`; `test_slug_max_24`; `test_expand_env` (`${A}`, `${A:-d}`, unset `${A}` raises "needs A set in the brain's environment"); `test_validate_http_scheme` (`http://example.com` rejected, `http://localhost:3000` ok); `test_validate_rejects_token_param` (tokens never enter a row).
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_apps.py tests/test_memory.py`; expect FAIL.
- [ ] **Step 3:** Implement. Env refs stay verbatim in the row, expanded at connect time.
- [ ] **Step 4:** Run; expect PASS; `uv run ruff check; uv run ruff format --check`.
- [ ] **Step 5:** Commit `feat(brain): apps table and store (9a)`.

### Task 2: Names, permissions, hints

**Files:** `app_tools.py`, `test_app_tools.py`.

**Interfaces:** `spec_for(app_id, tool) -> ToolSpec | None` (None = dropped); `classify(tool) -> tuple[effect, locked]`; `_words(name)` splits on `_ - . space` and camelCase.

- [ ] **Step 1: Failing tests (parametrized):** readOnly and not destructive -> read; no annotations -> change; destructiveHint -> locked; whole words send/delete/remove/destroy/trash/pay/charge lock even if hinted read-only (`sendEmail`, `delete-file`, `trash message`); `resend_status` does not; bad chars become `_`; names truncated to fit `64 - len(app_id) - 2`, a clash keeps the first and logs; empty name dropped.
- [ ] **Step 2:** `uv run pytest tests/test_app_tools.py`; expect FAIL.
- [ ] **Step 3:** Implement against `toolbox.ToolSpec`.
- [ ] **Step 4:** Run; expect PASS; ruff.
- [ ] **Step 5:** Commit `feat(brain): map mcp tools to toolbox specs (9a)`.

### Task 3: Manager and fake server

**Files:** `apps.py`, `tests/fake_mcp_server.py` (stdio server via the SDK; tools `echo`, `read_note` (read-only hint), `delete_note` (destructive), `slow`, `big` (20k chars), `add_tool` (fires list-changed); argv modes `hang`, `exit`), `test_apps.py`.

**Interfaces:** `Apps(memory, notify, env, connect_timeout=30)` with `async start()` (spawns tasks, returns at once), `restart(id)`, `stop(id)`, `shutdown()`, `status(id) -> AppStatus(state off|connecting|connected|needs-sign-in|error, error, tool_count)`, `tools(id)`, `async call(id, tool, args, timeout=60)`. Each state change calls `notify("changed", {"what": "apps"})`.

Per app, one task `_run(row)` enters an `AsyncExitStack` (transport, then `ClientSession`), initializes, lists tools, publishes the session, then awaits a stop event; the stack closes in that same task (avoids anyio cancel-scope errors). `message_handler` re-lists on tool-list-changed. stdio uses `shutil.which(command)` (`.cmd` shims), env = SDK default + expanded app env, stderr to a null file, and kills the process tree on stop as `experts.kill_tree` does. A failure shows as the first line of the error, never env values.

- [ ] **Step 1: Failing tests (spawn `sys.executable fake_mcp_server.py`):** connects and lists tools; disabled stays `off`; `hang` at 0.5 s -> "did not answer in time"; `exit` -> `error`; bad command -> "cannot find the command X"; a failing app leaves another connected; restart reconnects; process gone after `stop` and `shutdown`; list-changed re-lists; unset env ref -> error line; state changes notify.
- [ ] **Step 2:** `uv run pytest tests/test_apps.py`; expect FAIL.
- [ ] **Step 3:** Implement `Apps` (connect wrapped in `asyncio.timeout`).
- [ ] **Step 4:** Run; expect PASS on this Windows machine; ruff.
- [ ] **Step 5:** Commit `feat(brain): app manager with stdio and http (9a)`.

### Task 4: Token file, HTTP, results, `AppSource`

**Files:** `apps.py`, `app_tools.py`, `toolbox.py`; tests `test_apps.py`, `test_app_tools.py`, `test_toolbox.py`.

**Interfaces:** `TokenFile(data_dir)` with `get/set/delete(app_id)` over `data_dir/app-tokens.json`; http sends `Authorization: Bearer` for `auth == "token"`. `format_result(app_id, result) -> str`; `AppSource(apps)` implements `Source` (`specs` for connected apps, `known_specs` adds last-known tools of others, `run` strips the prefix, `unavailable` gives "<app> is not connected right now.").

`format_result`: text blocks joined, embedded resource text kept, links as `name uri`, images as `[image: name]`, `structuredContent` as JSON only when no content, cut at 8,000, wrapped `<data kind="app" app="id">` via `tools._fence_safe`. Errors as `RpcError(tool_failed, ...)`: `isError` -> "<app> could not do that: <first line>"; timeout -> "<app> did not answer in time."; protocol error -> "<app> said: <first line>".

- [ ] **Step 1: Failing tests:** token file roundtrip and absent from the db; localhost HTTP fake records the bearer header; text/resource/image/structured formatting; cut at 8,000; `</data>` in text cannot close the fence; isError and timeout lines; toolbox: app tools listed and run, read defaults auto and change defaults ask, locked asks and refuses `set_mode auto`, offline app raises the plain error, over-long names dropped from `model_tools`.
- [ ] **Step 2:** `uv run pytest tests/test_apps.py tests/test_app_tools.py tests/test_toolbox.py`; expect FAIL.
- [ ] **Step 3:** Implement. `AppSource` adds no mode storage: it reuses the `permissions` table, so the existing Permissions panel lists app tools unchanged.
- [ ] **Step 4:** Run; expect PASS; ruff.
- [ ] **Step 5:** Commit `feat(brain): app tool source, results and token file (9a)`.

### Task 5: Home calls, wiring, docs

**Files:** `tools.py` (`app_home_tools(apps, memory, tokens)`), `sessions.py`, `main.py`; tests `test_tools.py`, `test_sessions.py`, `test_main.py`; docs.

**Interfaces:** Home-only tools returning JSON text: `list_apps` -> `{"apps":[{id,name,transport,auth,enabled,status,error,tools:[{name,effect,locked}]}]}`; `add_app {name, transport, command?, args?, env?, url?, auth, token?}` (token goes to `TokenFile`, then connects); `set_app_enabled {id, enabled}`; `remove_app {id}` (stops, deletes row and token); `restart_app {id}`. Refusals raise `RpcError(invalid_params, plain line)`. Home re-lists on the existing `changed` notification with `{"what":"apps"}`. `Session` takes `apps: Apps | None` and appends `AppSource`. `main.py` calls `await apps.start()` after the server is up and `await apps.shutdown()` before `memory.close()`.

- [ ] **Step 1: Failing tests:** list shape; add connects and lists tools; duplicate name gets a suffix; bad input (no command, plain-http remote, token auth without token) gives a plain line; disable hides tools; remove deletes row and token; Home tools lack the `scout` audience; session includes `AppSource`; main shuts apps down before memory closes and boots despite a hanging app.
- [ ] **Step 2:** `cd brain && uv run pytest`; expect only new tests FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** `uv run pytest && uv run ruff check && uv run ruff format --check`; expect clean.
- [ ] **Step 5: Docs:** README.md; `docs/brain.md` (modules, `AppSource`, the calls, data files); rewrite `docs/connected-apps.md` for the Python brain (black and white Mermaid, OAuth marked 9c); `docs/testing/feature-test-guide.md` (real stdio app: read runs, change asks, locked asks every time, kill it and see `error`); CLAUDE.md layout mentions `apps.py`.
- [ ] **Step 6:** Commit `feat(brain): apps in the toolbox and Home calls (9a)`.

---

# Slice 9b: Home Connections page and desktop IPC on the brain

Modify `packages/protocol/src/connections.ts`, `bodies/desktop/src/main/ipc/connections.ts`, `main/index.ts`, `bodies/ui/src/home/connections-panel.tsx`, `createFakeHostBridge` (each with its test).

### Task 1: Shared types

**Interfaces:** zod `AppInfo`, `AppsList`, `AppAddParams` mirroring 9a T5 exactly.

- [ ] **Step 1: Failing tests** in `connections.test.ts`: parse a real `list_apps` sample; reject an unknown transport; stdio needs `command`, http needs `url`; `token` only with auth token.
- [ ] **Step 2:** `pnpm --filter @tagalong/protocol test`; expect FAIL.
- [ ] **Step 3:** Replace the old connection types; drop Popular and Claude Code "found" shapes nothing else imports.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `refactor(protocol): app list types for the brain (9b)`.

### Task 2: Desktop IPC calls the brain

**Interfaces:** consumes `BrainClient.call(tool, input) -> Promise<Part[]>`. Same IPC channel names now map to `list_apps`, `add_app`, `set_app_enabled`, `remove_app`, `restart_app`; `signInConnection` rejects "Sign-in comes with the next update" until 9c. Deps become `{ brain, answer, reply }`. Brain `changed` with `what: "apps"` reaches the renderer as the existing `connections.changed` event with no payload.

- [ ] **Step 1: Failing tests** in `connections.test.ts`: each handler sends the right tool and input and parses the text part as JSON; `addConnection` rejects params failing `AppAddParams` before any call; `BrainOffline` surfaces as a readable message; nothing calls `engine().call('connections.*')`.
- [ ] **Step 2:** `pnpm --filter @tagalong/desktop test connections`; expect FAIL.
- [ ] **Step 3:** Rewrite `registerConnectionIpc`; update its call site in `main/index.ts`.
- [ ] **Step 4:** Run; expect PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(desktop): connection IPC talks to the brain (9b)`.

### Task 3: Connections page

**Interfaces:** rows show name, transport, status text plus dot, error line, tool count, enable switch, Restart, Remove; one Add form (stdio: command, args, env lines `KEY=${KEY}`; http: url, auth none or token with a password field). Reuse `AddForm` and `splitCommand`. Tool permissions stay in the Permissions panel.

- [ ] **Step 1: Failing tests** in `connections-panel.test.tsx`: lists apps with status text; add stdio sends `{transport:'stdio',command,args,env,auth:'none'}`; http token is sent once and the field clears; toggle, Restart call their IPC; Remove confirms first; `connections.changed` re-lists; error status shows the plain line; brain-offline note; no sign-in button yet.
- [ ] **Step 2:** `pnpm --filter @tagalong/ui test connections-panel`; expect FAIL.
- [ ] **Step 3:** Implement; update the fake bridge.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`; if an e2e spec touches Connections, make its fake brain answer `list_apps` and run `pnpm --filter @tagalong/desktop test:e2e`.
- [ ] **Step 5: Docs:** README.md, `docs/connected-apps.md` (Home page), `docs/testing/feature-test-guide.md` (Connections steps), `docs/brain.md`.
- [ ] **Step 6:** Commit `feat(ui): connections page on the brain (9b)`.

---

# Slice 9c: OAuth sign-in and final docs

New: `brain/src/brain/app_oauth.py`, `brain/tests/test_app_oauth.py`, `fake_oauth_server.py`. Modified: `apps.py`, `tools.py`, `body-tools.ts`, `ipc/connections.ts`, `connections-panel.tsx` (+ tests).

### Task 1: Token storage for the SDK

**Interfaces:** `FileTokenStorage(data_dir, app_id)` implementing `TokenStorage` over `data_dir/app-oauth/<app_id>.json`, plus `clear()`.

- [ ] **Step 1: Failing tests:** tokens and client info roundtrip; missing or corrupt file gives None; `clear()` removes it; token text never logged.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_app_oauth.py`; expect FAIL.
- [ ] **Step 3:** Implement with the SDK's pydantic models.
- [ ] **Step 4:** Run; expect PASS; ruff.
- [ ] **Step 5:** Commit `feat(brain): oauth token storage in the data dir (9c)`.

### Task 2: Loopback listener and sign-in flow

**Interfaces:** `LoopbackCallback` with `async start() -> str` (binds `127.0.0.1`, port 0, returns the redirect URI), `async wait(timeout=300) -> tuple[code, state]`, `close()`; serves exactly one request, then closes. `make_provider(app, storage, redirect_uri, open_url) -> OAuthClientProvider` with `client_name="Tagalong"`, PKCE and dynamic registration; `open_url` refuses non-https ("The sign-in address was not https, so it was not opened."). `Apps.sign_in(app_id)`; an oauth app with no tokens starts `needs-sign-in` without opening a browser, and a 401 mid-session flips it back.

- [ ] **Step 1: Failing tests** with `fake_oauth_server.py` (metadata, registration, authorize, token): listener serves one request, loopback only, timeout closes the port; end-to-end sign-in saves tokens and connects; http URL refused; state mismatch rejected; no tokens means no browser; abandoned sign-in ends `needs-sign-in`; removing the app clears its oauth file.
- [ ] **Step 2:** `uv run pytest tests/test_app_oauth.py tests/test_apps.py`; expect FAIL.
- [ ] **Step 3:** Implement the listener with `asyncio.start_server`.
- [ ] **Step 4:** Run; expect PASS; ruff.
- [ ] **Step 5:** Commit `feat(brain): oauth sign-in for http apps (9c)`.

### Task 3: Body `open_url` and `sign_in_app`

**Interfaces:** body tool `open_url {url}` in `body-tools.ts` (https only, `effect: "change"`, runs `shell.openExternal`); Home tool `sign_in_app {id}` asks the online body via `Bodies.use`, returns at once with status `connecting`, and the outcome arrives by `changed`. No online body with `open_url`: "Open Tagalong on the machine the brain runs on to sign in." Desktop `signInConnection` now calls it.

- [ ] **Step 1: Failing tests:** brain, a fake body records the `open_url` call; no body gives the plain error; desktop, `open_url` rejects `http:` and non-URLs and opens https; `signInConnection` calls `sign_in_app`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_tools.py`; `pnpm --filter @tagalong/desktop test`; expect FAIL.
- [ ] **Step 3:** Implement both sides.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(brain,desktop): sign-in opens through the body (9c)`.

### Task 4: Sign-in button and final docs

- [ ] **Step 1: Failing tests** in `connections-panel.test.tsx`: `needs-sign-in` shows "Sign in" calling the IPC; `connecting` shows "Waiting for the browser"; adding an oauth app offers sign-in at once; a note says sign-in needs the brain and browser on one machine.
- [ ] **Step 2:** `pnpm --filter @tagalong/ui test connections-panel`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full checks: `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5: Docs:** README.md; `docs/brain.md` (OAuth, `open_url`, `app-oauth/`); `docs/connected-apps.md` (black and white Mermaid sign-in diagram, same-machine limit, out-of-scope list); `docs/testing/feature-test-guide.md` (real OAuth server, abandon the browser, restart).
- [ ] **Step 6:** Commit `feat(ui): sign in to connected apps from Home (9c)`.
