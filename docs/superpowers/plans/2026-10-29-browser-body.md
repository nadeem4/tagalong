# Browser Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Chrome extension becomes `bodies/browser` (`@tagalong/browser`), a body that dials the Python brain over contract v1 and gives Scout tools to read, search and act on the person's own browser, one install per browser and profile.

**Architecture:** The desktop's `BrainClient` moves into `@tagalong/contract` and both bodies use it. The browser body is a thin Chromium API layer (`src/layer/`) under small tested modules (identity, settings, permission broker, tools), wired together by `src/body.ts` and a one-screen `service-worker.ts`. Permissions are optional and asked from a small extension window the first time a tool needs one. The brain gains almost nothing: a no-wake rule for `browser` bodies (12a), two event kinds (12b) and an optional `Body.display` field with routing (12c).

**Tech Stack:** TypeScript, vitest (jsdom for the page reader), Vite, Chrome MV3 APIs behind interfaces; Python 3.12, pytest, pydantic (brain slices); React only in the desktop Settings section.

**Spec:** `docs/superpowers/specs/2026-10-29-browser-body-design.md` (approved). Style reference: `docs/superpowers/plans/2026-10-29-guardrails.md`. Contract: `protocol/README.md`.

## Execution: stacked pipeline, one session (the person's decision)

Run 12a, 12b and 12c in one session as stacked PRs:

1. 12a: Sonnet builds task by task (per-task reviews on Sonnet) in worktree `ai_pet-12a`, branch
   `feat/12a-browser-body` off main; PR base `main`. Then the Opus `reviewer` reviews 12a and fixes are applied,
   **while** a Sonnet builder starts 12b in worktree `ai_pet-12b`, branch `feat/12b-browser-reading` off 12a.
2. 12b: PR base `feat/12a-browser-body`. Opus reviews 12b **while** 12c builds in `ai_pet-12c` off 12b
   (PR base `feat/12b-browser-reading`).
3. Opus reviews 12c.
4. Opus reviews the whole stack (all three diffs together, against this plan and the spec).
5. Merge in order: 12a (squash, CI green) → rebase 12b onto main, retarget its PR to `main`, CI green, squash →
   same for 12c. Merge without asking once green; never merge red or running checks.

Rules: fixes on a lower slice are rebased up into the slices above before their review. CI runs only on PRs
into `main`, so each builder runs the full local suite (below) before its review. Never two agents in one
worktree. Update each tracker row (status, PR link, `Next:`) as it moves.

## Global Constraints

- Contract v1 stays version 1. Only one contract change in the whole plan: optional `Body.display?: boolean` (default true), in 12c. Tool names are plain (`tabs`, `page_parts`, `browser_search`, `tab_actions`, no `__`); the brain shows them as `<id>__<tool>`.
- Body: `{ id: "<browser>-<4 random chars>", kind: "browser", name }`. `<browser>` is one of `chrome, edge, brave, opera, vivaldi, arc, chromium`; the 4 chars are `[a-z0-9]`; the id is made once and saved in `chrome.storage.local`. The `name` defaults to the browser's name ("Chrome"); the popup's optional name field overrides it.
- Default brain address `127.0.0.1:47321` (`ws://`), saved in `chrome.storage.local`, changing it reconnects. Retry is a fixed 2 s. Brain `use` timeout 30 s, applied unchanged.
- Page text is capped at 40,000 characters with a plain "truncated" note. A sleeping (discarded) tab is never reloaded. Locked pages (`chrome://`, the Web Store, other extensions) fail with `tool_failed` and a plain reason.
- Permissions: install asks only for `storage`, `scripting` and `alarms` (no browser warning). Everything else is optional and requested only from a click on an extension page, never from the service worker. The tool waits up to 25 s for the answer; declined, closed or silent is `tool_failed` with a plain reason. Granted once, never asked again.
- Read tools carry `effect: "read"` and no `confirm`. `tab_actions` carries `effect: "change"` and no `confirm`.
- Keepalive: the browser's `BrainClient` calls the brain tool `spend_today` every 20 s while online. `last_seq` lives in `chrome.storage.session`. Event `tab` is throttled to one per 2 s, URL without query string or fragment; `tab` and `download` are `wakes=False` on the brain.
- Nothing is sent automatically except the two 12b facts (`tab`, `download`); Scout reads only when the model calls a tool. No screenshots by default. No form filling or clicking.
- Dependency graph: `bodies/browser` imports `@tagalong/contract` and `@mozilla/readability` only (no `@tagalong/protocol`, `@tagalong/ui`, React). `protocol/ts` imports zod and nothing else.
- Every new file opens with a 2-6 line header; comments say why, not history. Diagrams, if any, are black-and-white Mermaid opening with `%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%`.
- **No Claude or AI attribution anywhere**: no "Co-Authored-By" trailer, no "Generated with" line, no robot emoji or Claude link in commits, PR titles or bodies, docs or code. Applies to every sub-agent and to every commit step below.
- TDD: failing test first, watch it fail, then implement. Commits and PR titles are Conventional Commits, lowercase, under 72 chars, `type(scope): plain words (12a)`. PR bodies follow `.github/pull_request_template.md`; no Notion links.
- Each slice is one PR in a fresh session, from its own branch. Docs are part of done: `README.md`, the matching `docs/` file, `docs/testing/feature-test-guide.md`, and the CLAUDE.md Layout line.
- TS checks: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Brain checks: `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`. (The Bash tool may print "rtk: command not found"; use PowerShell or the dedicated tools.)

## Review Focus

Most likely to bite first. Each line names the task whose tests pin it.

1. A page or selection far past 40,000 characters floods the turn. Expected: cut with a "truncated" note. 12a T4.
2. Reading a sleeping tab reloads it, or a locked page (`chrome://`, Web Store) gives a cryptic browser error. Expected: `tool_failed` saying asleep / locked, no reload. 12a T4.
3. The permission window is closed, ignored or declined and the tool hangs or says nothing. Expected: `tool_failed` with a plain reason within 25 s; two calls needing the same permission share one window. 12a T5.
4. The service worker calls `chrome.permissions.request` (it throws outside a click). Expected: only the permission page does; a source test pins it. 12a T5, T7.
5. Two browsers or two profiles knock each other off the brain. Expected: separate random ids, stable across restarts. 12a T3.
6. Opening Chrome wakes Scout to greet. Expected: no `body_online` wake for kind `browser`. 12a T8.
7. The worker is stopped after 30 s idle, or restarts and loses its place. Expected: keepalive every 20 s; `last_seq` read back from session storage so a restart replays. 12a T2, T7.
8. A `forms` read leaks what the person typed, or `tab`/`download` events leak query strings or prompt for permissions. Expected: field names, labels and types only; URLs without query/fragment; events flow only if a permission is already granted. 12b T3, T5.
9. `picture` of a background tab switches tabs. Expected: `tool_failed` saying only the tab in front can be pictured. 12b T2.
10. `tab_actions` `open` accepts `javascript:`, `file:` or `chrome:` URLs. Expected: `invalid_params`, http and https only. 12c T2.
11. A browser-originated `say` is shown nowhere, or moves the "last body" off the desktop; an ask opens with only a display-less body online. Expected: the turn's `body` is a displaying body (or null), `_last_body` unchanged, the ask is refused at once like "nobody online". 12c T1.

## File Structure

| File                                                                         | Responsibility                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `protocol/ts/src/brain-client.ts` (moved, 12a)                               | `BrainClient`, `BrainOffline`, `RpcError`, `SeqStore`, keepalive; used by both bodies        |
| `bodies/browser/src/layer/api.ts` (12a)                                      | The thin browser-API interfaces (`TabsApi`, `PageApi`, ...) the tools use; no `chrome.*`     |
| `bodies/browser/src/layer/chromium.ts` (12a)                                 | The Chromium implementations of those interfaces; the only file with `chrome.*` besides glue |
| `bodies/browser/src/identity.ts`, `settings.ts` (12a)                        | Browser detection and body id; address and name in storage                                   |
| `bodies/browser/src/permissions.ts` (12a)                                    | `PermissionBroker`, `Need`, plain denial sentences                                           |
| `bodies/browser/src/permission/` (12a)                                       | The permission window: `model.ts` (tested), `permission.html`, `permission.ts` (glue)        |
| `bodies/browser/src/popup/` (12a)                                            | The toolbar popup: `model.ts` (tested), `popup.html`, `popup.ts`, `popup.css`                |
| `bodies/browser/src/tools/` (12a-c)                                          | `registry.ts`, `tabs.ts`, `page-parts.ts`, `browser-search.ts`, `tab-actions.ts`             |
| `bodies/browser/src/body.ts` (12a)                                           | Builds the `BrainClient` from identity, settings and tools; restart on settings change       |
| `bodies/browser/src/service-worker.ts`                                       | One screen of wiring and top-level listeners                                                 |
| `bodies/browser/src/content/` (kept)                                         | `read-page.ts`, `page-reader.ts`, (12b) `page-parts.ts`: injected on demand                  |
| `bodies/browser/src/events.ts` (12b), `ask-scout.ts` (12c)                   | `tab`/`download` events; context menu and omnibox `say`                                      |
| `bodies/desktop/src/main/ipc/browser.ts`, `renderer/.../browser-section.tsx` | Settings "Add Scout to your browser": folder lookup, Show folder, copy buttons               |
| `brain/src/brain/events.py`, `sessions.py`, `bodies.py`, `asks.py`, `mind/`  | no-wake rule (12a); `tab`/`download` kinds and prompt line (12b); `display` routing (12c)    |

---

## Slice 12a: Browser body on the brain

Branch `feat/12a-browser-body`. PR title `feat(browser): the browser as a body on the brain (12a)`. 11 tasks. **Larger than the usual 500-1,000 lines:** about 1,300 added lines (code and tests) plus about 2,400 deleted (side panel, pairing, port bridge, `EngineConnection`, their tests), and a folder rename. The rename is `git mv` (reviews as renames) and the deletions are one task (T7); say so under "Why" in the PR. It cannot split further: the extension is broken until it talks to the brain, and the old code cannot be deleted before the new code replaces it.

**Done when:** `bodies/browser` builds to `dist/`; loaded unpacked it shows in a `hello` as `chrome-xxxx` / kind `browser` with tools `tabs` (`list`, `read`); a read of an open page asks for permission through a small window and then returns text; the desktop starts with `BrainClient` from `@tagalong/contract` and no behaviour change; Settings shows "Add Scout to your browser"; the old Browser extension health row is gone; docs updated.

**Docs (T11):** `docs/browser-extension.md` renamed `docs/browser-body.md` and rewritten (tools, permissions, identity, events section stub, build/load), `docs/architecture.md`, `docs/protocol.md`, `docs/desktop.md`, `docs/development.md`, `docs/bubble.md`, `docs/README.md`, `README.md` (the Chrome steps), `CLAUDE.md` (lines naming `apps/extension`), `protocol/README.md` (Body `kind` wording and the example), `docs/testing/feature-test-guide.md` (replace the whole "The Chrome extension" X.1-X.14 section).

### Task 1: Move the extension to `bodies/browser`

**Files:**

- Move: `apps/extension` to `bodies/browser` (`git mv`; leave `out/`, `dist/` and `tsconfig.tsbuildinfo` out, they are build output)
- Modify: `bodies/browser/package.json` (name `@tagalong/browser`), `bodies/browser/vitest.config.ts` (project name), `tsconfig.json`, `tsconfig.tests.json`, `vitest.config.ts`, `pnpm-workspace.yaml`, `eslint.config.js:159`, `bodies/desktop/electron-builder.json:16`, `bodies/desktop/src/main/packaging.test.ts:74-79`, `.gitignore` and `.prettierignore` if they name `apps/extension` (search hidden files too), path mentions in `docs/` and `README.md` (mechanical only; the rewrite is T11)
- Test: `bodies/desktop/src/main/packaging.test.ts`

**Interfaces:**

- Produces: workspace package `@tagalong/browser` at `bodies/browser`; build output `bodies/browser/dist`; `apps/*` no longer exists (nothing else lives there).

- [ ] **Step 1: Write the failing test.** In `packaging.test.ts` change the extraResources test to expect `{ from: '../browser/dist', to: 'extension' }` (rename the test "ships the built browser body next to app.asar, for Load unpacked").
- [ ] **Step 2:** `pnpm vitest run packaging.test`. Expect FAIL (path still `../../apps/extension/dist`).
- [ ] **Step 3:** `git mv apps/extension bodies/browser`, then fix every reference above. `electron-builder.json` path is relative to `bodies/desktop`, so it becomes `../browser/dist` (the old `../../apps/...` was relative to the same folder; recompute, do not copy). Remove `apps/*` from `pnpm-workspace.yaml`, the `vitest.config.ts` projects list, and the `apps/*` globs in `tsconfig.tests.json`; point the root `tsconfig.json` reference and the ESLint block at `bodies/browser`. Update `bodies/browser/tsconfig.json` reference paths (`../../packages/protocol` and `../../bodies/ui` stay valid from `bodies/browser`; check). Run `pnpm install` to refresh `pnpm-lock.yaml`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` and `pnpm --filter @tagalong/browser build`. Expect PASS and `bodies/browser/dist/manifest.json` present.
- [ ] **Step 5: Commit** `refactor(browser): move the extension to bodies/browser (12a)`.

### Task 2: `BrainClient` moves into `@tagalong/contract`

**Files:**

- Move: `bodies/desktop/src/main/brain/brain-client.ts` to `protocol/ts/src/brain-client.ts`; `brain-client.test.ts` to `protocol/ts/src/brain-client.test.ts`
- Modify: `protocol/ts/src/index.ts` (add `export * from './brain-client.js';`), every desktop importer of `./brain-client` or `../brain/brain-client` (list: `main/index.ts`, `main/status-marks.ts`, `main/brain/start.ts`, `start.test.ts`, `body-tools.ts`, `body-tools.test.ts`, `offline-watch.ts`, `call-json.ts`, `main/ipc/{approvals,connections,jobs,memory,permissions,turns}.ts` and their tests, `ipc/brain-link.ts`): import from `@tagalong/contract`. No re-export shim.
- Test: `protocol/ts/src/brain-client.test.ts`

**Interfaces:**

- Consumes: existing `BrainClient` behaviour (hello, say, call, event, answer, reconnect, replay).
- Produces (all exported from `@tagalong/contract`): `BrainClient`, `BrainOffline`, `RpcError`, `type BrainSocket`, `type BrainStatus`, `type BrainClientOptions`, and
  `interface SeqStore { load(): Promise<number | null>; save(seq: number): void }`.
  `BrainClientOptions` gains `body: Body` (required), `seqStore?: SeqStore`, `keepalive?: { everyMs: number; tool: string }`. Default store keeps `last_seq` in memory only (load resolves `null`).
  Request ids become `` `${body.id}-${n}` ``. `hello` sends `body` exactly as given.

- [ ] **Step 1: Write failing tests** (beside the moved ones, which keep passing with `body` added to `setup()`): `hello_sends_the_body_it_was_given` (body `{id:'chrome-7k2f',kind:'browser',name:'Chrome'}`); `request_ids_start_with_the_body_id`; `loads_last_seq_from_the_store_before_hello` (store resolves 5, hello params `last_seq: 5`); `saves_each_new_seq_and_the_resync_seq` (notification seq 7 saved; a `resync: true` hello with `seq: 40` saves 40); `no_load_on_reconnect_keeps_memory_seq` (the store is read once per client, later hellos use the live value); `keepalive_calls_the_tool_every_20s_while_online` (fake timers, `everyMs: 20000, tool: 'spend_today'`, one `call` frame per 20 s, none before hello result, none after the socket drops or `stop()`); `keepalive_failure_is_swallowed` (call rejects, client stays online).
- [ ] **Step 2:** `pnpm vitest run brain-client`. Expect FAIL (options missing).
- [ ] **Step 3:** Implement. `hello()` becomes `async`: `if (!this.seqLoaded) { this.lastSeq = await store.load(); this.seqLoaded = true; }`, then returns early if `this.socket !== socket` (superseded). Call `store.save` wherever `lastSeq` is assigned. Keepalive: a `setInterval` started on `setStatus('online')`, cleared in `closed()`, `stop()` and on `outdated`; each tick `void this.call(tool).catch(() => undefined)`. Update the file header (a body's end of contract v1, not the desktop's). In desktop `start.ts` pass `body: { id: 'desktop', kind: 'desktop', name: 'Desktop' }`.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`. Expect PASS, desktop tests unedited apart from import paths. Confirm the e2e fake brain still passes: `pnpm --filter @tagalong/desktop test:e2e` (Windows) or note it runs in CI.
- [ ] **Step 5: Commit** `refactor(contract): share BrainClient between bodies (12a)`.

### Task 3: Browser identity and settings

**Files:**

- Create: `bodies/browser/src/identity.ts`, `bodies/browser/src/settings.ts`, `bodies/browser/src/layer/api.ts` (the `StorageArea` interface only, for now)
- Test: `bodies/browser/src/identity.test.ts`, `bodies/browser/src/settings.test.ts`

**Interfaces:**

- Produces `layer/api.ts`: `interface StorageArea { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }`.
- Produces `identity.ts`: `type BrowserKind = 'chrome'|'edge'|'brave'|'opera'|'vivaldi'|'arc'|'chromium'`; `detectBrowser(brands: readonly string[], userAgent: string): BrowserKind`; `browserName(kind: BrowserKind): string` (`Chrome`, `Edge`, `Brave`, `Opera`, `Vivaldi`, `Arc`, `Chromium`); `makeBodyId(kind: BrowserKind, random: () => string): string` (`<kind>-<random()>`); `loadBodyId(storage: StorageArea, kind: BrowserKind, random?: () => string): Promise<string>` (key `bodyId`; default random is 4 chars of `[a-z0-9]`).
- Produces `settings.ts`: `DEFAULT_ADDR = '127.0.0.1:47321'`; `parseAddr(input: string): string | null` (trimmed `host:port`, port 1-65535, host `[A-Za-z0-9.-]+`; null otherwise; a bare host or `ws://` prefix is not accepted); `readSettings(storage): Promise<{ addr: string; name: string | null }>` (keys `brainAddr`, `bodyName`; bad stored values fall back to the default / null); `saveAddr(storage, addr: string): Promise<boolean>` (false and nothing saved when `parseAddr` is null); `saveName(storage, name: string): Promise<void>` (empty clears, stored trimmed, at most 32 chars).

- [ ] **Step 1: Write failing tests.** identity: `detects_each_browser_from_brands` (`'Microsoft Edge'` to edge, `'Brave'`, `'Opera'`, `'Vivaldi'`, `'Arc'`, `'Google Chrome'` to chrome, only `'Chromium'` to chromium); `falls_back_to_the_user_agent` (empty brands; `Edg/` edge, `OPR/` opera, `Vivaldi/`, plain `Chrome/` chrome, unknown to chromium); `body_id_matches_the_contract_pattern` (`/^[a-z0-9-]{1,32}$/` and `chrome-7k2f` shape); `body_id_is_made_once_and_kept` (second `loadBodyId` returns the stored value even with a different random); `two_installs_get_different_ids` (two empty storages, different random). settings: `defaults_when_nothing_is_stored`, `parseAddr` accept/reject table (`127.0.0.1:47321`, `host.local:1`, `:80`, `host`, `host:0`, `host:65536`, `ws://h:1`), `saveAddr_refuses_a_bad_address_and_keeps_the_old_one`, `saveName_trims_caps_and_clears`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/identity bodies/browser/src/settings`. Expect FAIL (modules missing).
- [ ] **Step 3:** Implement as above; no `chrome.*` in these files.
- [ ] **Step 4:** Re-run; expect PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): body id per install and brain address setting (12a)`.

### Task 4: The `tabs` tool: `list` and `read`

**Files:**

- Create: `bodies/browser/src/tools/registry.ts`, `bodies/browser/src/tools/tabs.ts`, `bodies/browser/src/content/limits.ts`
- Modify: `bodies/browser/src/layer/api.ts` (add `TabInfo`, `TabsApi`, `PageApi`), `bodies/browser/src/content/read-page.ts` (use local limits), `bodies/browser/src/content/read-page.test.ts` and `injected-weight.test.ts` (new imports)
- Create: `bodies/browser/src/layer/chromium.ts` (first piece: `chromeTabs: TabsApi`, `chromePage: PageApi`, built from the code in `chrome-adapters.ts`; `chrome-adapters.ts` stays until T7)
- Test: `bodies/browser/src/tools/tabs.test.ts`, `bodies/browser/src/tools/registry.test.ts`

**Interfaces:**

- Consumes: `StorageArea` (T3); `PermissionBroker` (T5, injected through a one-method interface below so this task can be tested alone).
- Produces `layer/api.ts`: `interface TabInfo { id: number; windowId: number; title: string; url: string; active: boolean; discarded: boolean }`; `interface TabsApi { list(): Promise<TabInfo[]>; get(id: number): Promise<TabInfo | null>; activeInFocusedWindow(): Promise<TabInfo | null> }`; `interface PageApi { read(tabId: number): Promise<PageReading> }` (`PageReading` from `content/read-page.ts`, injects the reader and runs it).
- Produces `content/limits.ts`: `MAX_PAGE_TEXT_CHARS = 40_000`, `MAX_SELECTION_CHARS = 20_000` (no imports; the extension no longer depends on `@tagalong/protocol`).
- Produces `tools/registry.ts`: `interface BrowserTool { tool: Tool; run(input: Record<string, unknown>): Promise<Part[]> }`; `toolset(defs: BrowserTool[]): { tools(): Tool[]; run(name: string, input: Record<string, unknown>): Promise<Part[]> }` (unknown name throws `RpcError(ErrorCode.unknown_tool, 'unknown tool')`); `failed(message: string): RpcError` (`tool_failed`); `invalid(message: string): RpcError` (`invalid_params`).
- Produces `tools/tabs.ts`: `interface Needs { ensure(need: Need, reason: string): Promise<void> }` (satisfied by `PermissionBroker`); `tabsTool(deps: { tabs: TabsApi; page: PageApi; needs: Needs; bodyName: string }): BrowserTool`. Tool `tabs`, `effect: 'read'`, schema `{ action: 'list' | 'read', tab_id?: number }`, description for the model, plain and short, saying when to use it and ending with the body's name ("This is the <bodyName> browser."). `list` returns one text part: JSON `{"tabs":[{"id","title","url","active","asleep"}]}`. `read` returns one text part: lines `url: ...`, `title: ...`, `selection: ...` (only when non-empty), a blank line, then the page text, then `[truncated at 40,000 characters]` when the reader says truncated. `tab_id` omitted means the active tab of the focused window.

- [ ] **Step 1: Write failing tests** with fake `TabsApi`, `PageApi` and `Needs` (records calls): `list_returns_id_title_url_active_asleep`; `list_asks_for_the_tabs_permission_first` (`ensure({kind:'permission', name:'tabs'}, ...)` before listing); `read_defaults_to_the_active_tab`; `read_by_tab_id`; `read_asks_tabs_then_the_site` (needs recorded in order `tabs`, then `{kind:'site', origin:'https://example.com'}`); `read_formats_url_title_selection_and_text`; `read_omits_selection_when_empty`; `read_adds_the_truncated_note_at_40000` (Review Focus 1: reader returns `truncated: true`, output ends with the note; and the text handed over is never longer than 40,000 characters even if a fake reader returns more); `read_of_a_sleeping_tab_fails_asleep_without_reading` (`page.read` not called; message says the tab is asleep and Scout will not wake it); `read_of_a_locked_page_fails_plainly` (`chrome://settings`, `chrome-extension://x/a.html`, `https://chromewebstore.google.com/detail/x`, `view-source:`; message names what is locked; `page.read` not called); `read_with_no_active_tab_fails`; `read_when_the_reader_throws_is_tool_failed_with_a_plain_reason`; `unknown_action_is_invalid_params`; `a_denied_permission_surfaces_its_sentence`. registry: `run_unknown_tool_is_unknown_tool`, `tools_lists_declared_tools`. read-page: existing tests keep passing with limits imported from `./limits`; `injected-weight.test.ts` now asserts `limits.ts` has no imports and `read-page.ts` imports `./limits` and neither `@tagalong/protocol` nor `zod`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/tools bodies/browser/src/content`. Expect FAIL.
- [ ] **Step 3:** Implement. Locked-page check by URL: scheme not in `http:, https:, file:`, or host `chromewebstore.google.com`, or `chrome.google.com` with path starting `/webstore`. The origin for the site need is `new URL(url).origin`. Cap the text again in the tool (`slice(0, MAX_PAGE_TEXT_CHARS)`) as a belt for the reader's own cap.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): the tabs tool, list and read (12a)`.

### Task 5: Permission broker and the permission window

**Files:**

- Create: `bodies/browser/src/permissions.ts`, `bodies/browser/src/permission/model.ts`, `bodies/browser/src/permission/permission.html`, `bodies/browser/src/permission/permission.ts`
- Modify: `bodies/browser/src/layer/chromium.ts` (add `chromePermissions: PermissionsApi`, `chromePrompt: PermissionPrompt`), `bodies/browser/vite.config.ts` (add `permission` input)
- Test: `bodies/browser/src/permissions.test.ts`, `bodies/browser/src/permission/model.test.ts`

**Interfaces:**

- Produces `permissions.ts`: `OPTIONAL_PERMISSIONS = ['tabs','history','bookmarks','downloads','sessions','readingList','tabGroups','contextMenus'] as const`; `type OptionalPermission`; `type Need = { kind: 'permission'; name: OptionalPermission } | { kind: 'site'; origin: string }`; `interface PermissionsApi { contains(need: Need): Promise<boolean>; getAll(): Promise<{ permissions: string[]; origins: string[] }>; remove(need: Need): Promise<boolean> }`; `type Answer = 'granted' | 'declined' | 'closed'`; `interface PermissionPrompt { ask(need: Need, reason: string): Promise<Answer> }`; `PERMISSION_WAIT_MS = 25_000`; `denial(need: Need): string` (a plain sentence, for example "the person has not allowed reading example.com", "the person has not allowed Scout to see open tabs"); `class PermissionBroker { constructor(api: PermissionsApi, prompt: PermissionPrompt, waitMs?: number); ensure(need: Need, reason: string): Promise<void> }` (resolves when allowed; throws `RpcError(tool_failed, denial(need))` when declined, closed or after `waitMs`).
- Produces `permission/model.ts`: `type PermissionRequest = { id: string; need: Need; reason: string }`; `parseRequest(search: string): PermissionRequest | null` (query `id`, `kind`, `name` or `origin`, `reason`; null on anything malformed or an unknown permission name); `buttonsFor(need: Need): { label: string; scope: 'site' | 'all' | 'once' | 'no' }[]` (site need: `Allow on this site`, `Allow on all sites`, `Not now`; permission need: `Allow`, `Not now`); `chromeRequestFor(need: Need, scope): { permissions?: string[]; origins?: string[] } | null` (`site` gives `origins:[origin + '/*']`, `all` gives `origins:['<all_urls>']`, `once` gives `permissions:[name]`, `no` gives null).
- Produces in `layer/chromium.ts`: `chromePrompt.ask` opens `chrome.windows.create({ url: permission.html?..., type: 'popup', width: 420, height: 280 })`, resolves from a `chrome.runtime.onMessage` of `{ type: 'permission-answer', id, granted: boolean }` (granted maps to `granted`, else `declined`), or `closed` when `chrome.windows.onRemoved` fires for that window first. `permission.ts` is glue only: reads `parseRequest(location.search)`, renders buttons from `buttonsFor`, on click calls `chrome.permissions.request(chromeRequestFor(...))` inside the click handler, sends the answer message, closes the window.

- [ ] **Step 1: Write failing tests** (fake `PermissionsApi` and `PermissionPrompt`, fake timers). broker: `allowed_already_resolves_without_a_window`; `grant_then_resolves_after_a_recheck` (prompt answers `granted`, `contains` now true); `granted_but_not_actually_held_fails` (prompt says granted, `contains` still false); `declined_fails_with_the_plain_sentence`; `closed_fails_with_the_plain_sentence`; `silence_fails_after_25s` (advance 25,000 ms, rejects `tool_failed`, never earlier); `two_calls_for_the_same_need_share_one_window` (prompt `ask` called once); `different_needs_open_separate_windows`; `denial_sentences_name_the_site_or_the_ability`. model: `parseRequest_round_trips_a_site_need_and_a_permission_need`; `parseRequest_rejects_missing_id_unknown_name_and_bad_origin`; `site_need_has_three_buttons_and_permission_need_two`; `chromeRequestFor_maps_each_scope`; `no_scope_requests_nothing`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/permission`. Expect FAIL.
- [ ] **Step 3:** Implement. Broker keeps a `Map<string, Promise<Answer>>` keyed by `JSON.stringify(need)`, removed when settled; the 25 s race is per `ensure` call, not per window. `permission.html` is a small static page styled per DESIGN.md (system font, plain buttons); it says what Scout wants and why, using the `reason` text only through `textContent`.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(browser): ask for a permission when a tool needs it (12a)`.

### Task 6: The popup

**Files:**

- Create: `bodies/browser/src/popup/model.ts`, `popup.html`, `popup.ts`, `popup.css`
- Modify: `bodies/browser/vite.config.ts` (add `popup` input)
- Test: `bodies/browser/src/popup/model.test.ts`

**Interfaces:**

- Consumes: `parseAddr`, `readSettings`, `saveAddr`, `saveName`, `DEFAULT_ADDR` (T3); `Need`, `PermissionsApi` (T5); `BrainStatus` from `@tagalong/contract` (T2).
- Produces `popup/model.ts`: `statusLine(status: BrainStatus): string` (`connecting` "Connecting to Scout's brain...", `online` "Connected to Scout's brain", `offline` "Scout's brain is not reachable", `outdated` "Needs an update: this browser add-on is older than the brain"); `type GrantRow = { label: string; need: Need }`; `grantRows(all: { permissions: string[]; origins: string[] }): GrantRow[]` (only names in `OPTIONAL_PERMISSIONS` and origins; `<all_urls>` is one row "All sites"; each origin pattern `https://x.com/*` is "x.com"); `type WorkerQuery = { type: 'status' }`; `type WorkerStatus = { status: BrainStatus; id: string; name: string }`.
- Produces the popup contract with the worker: `chrome.runtime.sendMessage({ type: 'status' })` answers `WorkerStatus`; address and name edits are written with `saveAddr` / `saveName` (the worker restarts on the storage change in T7). `popup.ts` is glue: status line, address field (shows `DEFAULT_ADDR`, saves on change, shows "That is not an address like 127.0.0.1:47321" when `saveAddr` returns false), name field with the browser name as placeholder, the granted list with a Remove button each (`chrome.permissions.remove`).

- [ ] **Step 1: Write failing tests:** `statusLine_has_one_sentence_per_status`; `grantRows_lists_only_what_scout_can_ask_for` (a manifest-required `storage` is not listed); `grantRows_turns_origins_into_site_names`; `grantRows_collapses_all_urls_to_one_row`; `grantRows_is_empty_when_nothing_is_granted`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/popup`. Expect FAIL.
- [ ] **Step 3:** Implement `model.ts` and the glue; look follows DESIGN.md, fits 320 px wide.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(browser): toolbar popup for status, address, name and grants (12a)`.

### Task 7: Cut over: the service worker on the brain, and the old code deleted

**Files:**

- Create: `bodies/browser/src/body.ts`, `bodies/browser/src/body.test.ts`, `bodies/browser/src/source-guard.test.ts`
- Rewrite: `bodies/browser/src/service-worker.ts`, `bodies/browser/src/manifest.ts`, `bodies/browser/src/manifest.test.ts`, `bodies/browser/vite.config.ts`, `bodies/browser/package.json`, `bodies/browser/tsconfig.json`
- Delete: `src/capabilities.ts`, `src/chrome-adapters.ts`, `src/engine-connection.ts` and test, `src/options/`, `src/options.html`, `src/page-targets.ts`, `src/pairing.ts` and test, `src/port-bridge.ts` and test, `src/port-hub.ts` and test, `src/port-messages.ts`, `src/sidepanel/`, `src/sidepanel.html`, `src/status-text.ts` and test, `src/tab-capture.ts` and test, `src/test-support/fake-socket.ts` (all under `bodies/browser/`)
- Test: `body.test.ts`, `manifest.test.ts`, `source-guard.test.ts`

**Interfaces:**

- Consumes: `BrainClient`, `BrainSocket`, `BrainStatus`, `SeqStore` (T2); identity and settings (T3); `tabsTool`, `toolset` (T4); `PermissionBroker`, `chromePermissions`, `chromePrompt` (T5).
- Produces `body.ts`: `interface BodyDeps { storage: StorageArea; session: StorageArea; openSocket: (url: string) => BrainSocket; userAgent: string; brands: readonly string[]; tabs: TabsApi; page: PageApi; broker: PermissionBroker; random?: () => string }`; `createBody(deps: BodyDeps): { start(): Promise<void>; restart(): Promise<void>; stop(): void; info(): { status: BrainStatus; id: string; name: string } }`. `start` builds the identity and settings, creates the `BrainClient` with `body: { id, kind: 'browser', name }`, `tools: () => toolset.tools()`, `seqStore` backed by `session` key `lastSeq`, `keepalive: { everyMs: 20_000, tool: 'spend_today' }`, `retryMs` default; `restart` stops the client and starts a new one with the freshly read address and name. Notifications other than `use` and `cancel` are ignored (`onNotification` is a no-op, `onResync` a no-op).
- Produces the manifest (as data, `manifest.ts`): MV3, `name: 'Tagalong'`, `minimum_chrome_version: '116'`, `permissions: ['alarms','scripting','storage']`, `optional_permissions: [...OPTIONAL_PERMISSIONS]` (spelled out, not imported, so the manifest stays a plain object), `optional_host_permissions: ['<all_urls>']`, `action: { default_popup: 'popup.html', default_title: 'Tagalong' }`, no `side_panel`, no `options_ui`, no `commands`, `content_security_policy.extension_pages: "script-src 'self'; object-src 'self'; connect-src ws://*:*"` (any host, because the brain address is changeable and the brain can run on another machine; a source comment says why), and a description that says Scout reads pages in your browser only when it needs to.
- Worker: top-level listeners registered synchronously: `chrome.alarms.onAlarm` (reconnect alarm every 0.5 min calls `body.start()` if not online), `chrome.storage.onChanged` (`brainAddr` or `bodyName` in `local` triggers `restart()`), `chrome.runtime.onMessage` (answers `{type:'status'}` with `info()`), `chrome.runtime.onInstalled`/`onStartup` (start). `package.json` drops `@tagalong/protocol`, `@tagalong/ui`, `react`, `react-dom`, `@testing-library/react`; adds `@tagalong/contract: workspace:*`. Vite config inputs become `popup`, `permission`, `service-worker`; the React/`esbuild.jsx` setting goes. `tsconfig.json` references only `../../protocol/ts` and drops `jsx`.

- [ ] **Step 1: Write failing tests.** body: `hello_carries_a_browser_body_and_the_tabs_tool` (fake socket; body id matches `/^chrome-[a-z0-9]{4}$/` for a Chrome UA, kind `browser`, name `Chrome`, tools include `tabs`); `the_popup_name_overrides_the_default_name`; `a_second_install_gets_another_id` (two storages); `the_id_survives_a_restart`; `a_use_for_tabs_list_gets_its_output` (through the fake socket, with fake tabs and an allowed broker); `an_unknown_tool_is_unknown_tool`; `last_seq_is_read_from_session_storage_on_start` (session holds 9, hello has `last_seq: 9`); `restart_dials_the_new_address` (`saveAddr` then `restart`, second socket URL is the new one, `ws://` prefix); `keepalive_calls_spend_today_every_20s_while_online`; `brain_notifications_other_than_use_are_ignored` (an `ask` and a `reply` do nothing and throw nothing). manifest: replace the old tests: `is_manifest_v3_with_a_module_service_worker`; `requires_only_alarms_scripting_and_storage`; `lists_the_optional_permissions_from_the_design` (exact sorted set); `optional_host_permissions_is_all_urls_and_there_is_no_host_permissions`; `has_a_popup_and_no_side_panel_options_or_commands`; `lets_extension_pages_open_websockets_to_any_host`; `describes_scout_within_the_store_summary_limit` (132). source-guard (reads source files, like `injected-weight.test.ts`): `only_the_permission_page_and_popup_call_permissions_request` (`service-worker.ts`, `body.ts`, `permissions.ts` and `tools/` never contain `permissions.request`; `permission/permission.ts` does) and `bodies_browser_imports_no_protocol_or_ui_package` (no file under `src/` imports `@tagalong/protocol`, `@tagalong/ui`, `react`).
- [ ] **Step 2:** `pnpm vitest run bodies/browser`. Expect FAIL.
- [ ] **Step 3:** Implement `body.ts`, the manifest, the worker, the config changes, and delete the listed files. Add the real `chromeStorage`/`sessionStorage`/`webSocket` adapters to `layer/chromium.ts` (the adapter wraps `new WebSocket(url)` into `BrainSocket` the way `bodies/desktop/src/main/brain/start.ts` does). Run `pnpm install` to refresh the lockfile.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @tagalong/browser build`. Expect PASS and `dist/` holding `manifest.json`, `service-worker.js`, `popup.html`, `permission.html`, `page-reader.js` and no `sidepanel.html` or `options.html`.
- [ ] **Step 5: Commit** `feat(browser): the browser body talks to the brain, old engine link deleted (12a)`.

### Task 8: No wake when a browser connects (brain)

**Files:**

- Modify: `brain/src/brain/events.py` (`from_connect`), `brain/src/brain/sessions.py` (`_on_connect`)
- Test: `brain/tests/test_events.py`, `brain/tests/test_sessions.py`

**Interfaces:**

- Produces `from_connect(body_id: str, away_seconds: float | None, kind: str | None = None) -> Event | None`: returns `None` when `kind == "browser"`, otherwise unchanged. `Session._on_connect(body_id, away)` looks the body's `kind` up in `self._bodies.online()` and passes it.

- [ ] **Step 1: Write failing tests:** `test_events.py::test_browser_connect_never_wakes` (away 3600 s, kind `browser`, returns None); `test_desktop_connect_still_wakes_after_ten_minutes` (kind `desktop`, 600 s, Event `body_online`); `test_kind_unknown_keeps_old_behaviour` (kind None); `test_sessions.py::test_a_browser_body_returning_after_an_hour_starts_no_wake` (connect `chrome-7k2f` kind browser, disconnect, advance the fake clock 1 h, reconnect: no turn started, scheduler holds no group) and a paired desktop case that does wake.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_events.py tests/test_sessions.py -v`. Expect FAIL.
- [ ] **Step 3:** Implement; one condition in `from_connect`, one lookup in `_on_connect`.
- [ ] **Step 4:** `uv run pytest && uv run ruff check && uv run ruff format --check`. Expect PASS.
- [ ] **Step 5: Commit** `fix(brain): opening a browser does not wake Scout (12a)`.

### Task 9: Settings "Add Scout to your browser"

**Files:**

- Create: `bodies/desktop/src/main/ipc/browser.ts`, `bodies/desktop/src/main/ipc/browser.test.ts`
- Rewrite: `bodies/desktop/src/renderer/src/settings/browser-section.tsx` (and add `browser-section.test.tsx` beside it, following the neighbouring section tests)
- Modify: `bodies/desktop/src/shared/ipc.ts` (channels `browserFolder`, `showBrowserFolder`; types), `bodies/desktop/src/preload/index.ts`, `bodies/desktop/src/main/index.ts` (register, with `shell.showItemInFolder`), `bodies/desktop/src/renderer/src/settings/settings-page.tsx:334`, `settings/section.tsx:16` (title "Add Scout to your browser"), root `package.json` (`dev:desktop`)
- Test: `ipc/browser.test.ts`, `browser-section.test.tsx`, `packaging.test.ts` (one added test)

**Interfaces:**

- Produces `ipc/browser.ts`: `interface BrowserIpcDeps { packaged: boolean; resourcesPath: string; appPath: string; exists: (path: string) => boolean; showItemInFolder: (path: string) => void }`; `browserFolder(deps): { path: string; exists: boolean }` (packaged: `<resourcesPath>/extension`; dev: `<appPath>/../browser/dist`, normalised); `registerBrowserIpc(handle: IpcHandle, deps: BrowserIpcDeps): void` registering `IPC.browserFolder` (returns the folder) and `IPC.showBrowserFolder` (calls `showItemInFolder(path)` only when it exists, else throws "The browser add-on is not built yet").
- Produces the section: props `{ folder: { path: string; exists: boolean } | null }`, three numbered steps (open `chrome://extensions` or `edge://extensions`; turn on Developer mode; Load unpacked and choose the folder), buttons **Show folder**, **Copy folder path**, **Copy chrome://extensions**, **Copy edge://extensions** (clipboard through `navigator.clipboard`, as before); when `exists` is false it shows "Build it first: pnpm --filter @tagalong/browser build" and no Show folder. No pairing token, no mention of a token anywhere.
- Root `package.json`: `"dev:desktop": "pnpm --filter @tagalong/browser build && pnpm --filter @tagalong/desktop dev"`.

- [ ] **Step 1: Write failing tests:** `browser.test.ts::folder_is_resources_extension_when_packaged`; `folder_is_the_browser_dist_in_dev`; `reports_exists_from_the_disk_check`; `show_folder_reveals_the_folder`; `show_folder_refuses_when_not_built`. `browser-section.test.tsx`: `shows_the_three_steps`; `copy_buttons_write_the_folder_path_and_both_addresses`; `show_folder_calls_the_bridge`; `says_how_to_build_when_the_folder_is_missing`; `never_mentions_a_pairing_token`. `packaging.test.ts`: `dev_desktop_builds_the_browser_body_first` (reads root `package.json`, the script starts with `pnpm --filter @tagalong/browser build`).
- [ ] **Step 2:** `pnpm vitest run bodies/desktop`. Expect FAIL.
- [ ] **Step 3:** Implement. Follow the `IPC.pickFolder` pattern for channel naming and the preload exposure. Remove `pairingToken` reads from the section; the field itself is removed in T10.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Expect PASS.
- [ ] **Step 5: Commit** `feat(desktop): Add Scout to your browser in Settings (12a)`.

### Task 10: Remove the old Browser extension health row and the pairing token

**Files:**

- Modify: `bodies/ui/src/health.ts` (drop `extension` from `HealthFacts`, `HealthRowId`, labels, `extensionRow`, the row list), `bodies/ui/src/health-card.tsx` comment, `bodies/desktop/src/renderer/src/health-facts.ts` and `panel.tsx:64`, `bodies/desktop/src/shared/ipc.ts` (remove `hostsStatus`, `pairingToken`), `bodies/desktop/src/preload/index.ts:394`, `bodies/desktop/src/main/index.ts:1126` and its import, `bodies/desktop/src/main/ipc/settings.test.ts:60`
- Delete: `bodies/desktop/src/main/ipc/health.ts`, `health.test.ts`
- Test (edit to match): `bodies/ui/src/health.test.ts`, `health-card.test.tsx`, `companion-bubble-health.test.tsx`, `bodies/desktop/src/renderer/src/health-facts.test.ts`

**Interfaces:**

- Produces: `HealthFacts` without `extension`; `HealthRowId` without `'extension'`; no `IPC.hostsStatus`; `HostView` without `pairingToken`. Remaining rows (`brain`, `experts`, `connections`, `voice`, `microphone`) behave as before.

- [ ] **Step 1: Update the tests first:** in `health.test.ts` drop `extension` from `ALL_GOOD`, the row-order expectation and the "shows a missing extension as info" case; add `has_no_browser_extension_row` (no row id `extension`); `health-card.test.tsx` swaps its optional-row example to another optional row or a synthetic row; `health-facts.test.ts` drops `hostsStatus` from the fake host and the `pairingToken` literal; delete `health.test.ts` in `ipc/`.
- [ ] **Step 2:** `pnpm vitest run bodies/ui bodies/desktop`. Expect FAIL (type and behaviour still present).
- [ ] **Step 3:** Remove the code listed. Search the repo (including `bodies/desktop/e2e`) for `hostsStatus`, `hosts.status`, `pairingToken` and `Browser extension` and clear what is left in desktop and ui (`packages/core` keeps its own, left for row 13).
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Expect PASS.
- [ ] **Step 5: Commit** `refactor(desktop): drop the old browser extension health row (12a)`.

### Task 11: Docs for 12a

**Files:**

- Rename and rewrite: `docs/browser-extension.md` to `docs/browser-body.md` (Purpose, Where it lives, How it works with a Mermaid flow, Identity, Tools (`tabs` list and read, with schema and output), Permissions (table: tool to permission, the window, the 25 s wait), Popup, Install from the desktop, Failure handling, Privacy notes, Tests that pin it; an "Events" heading saying none yet, filled in 12b)
- Modify: `docs/architecture.md` (the extension rows and the dependency table), `docs/protocol.md:395`, `docs/desktop.md:663`, `docs/development.md`, `docs/bubble.md:38`, `docs/README.md` (index entry and link), `docs/chrome-web-store/listing.md` (paths only), `README.md` (the Chrome steps near line 502), `CLAUDE.md` (the `apps/extension` mentions: Direction and Layout lines now `bodies/browser: browser body (Chromium)`), `protocol/README.md` (Body `kind` examples `desktop`, `browser`; the "too far behind" example uses `chrome-7k2f` / kind `browser` / name `Chrome`), `docs/testing/feature-test-guide.md` (replace "The Chrome extension" X.1-X.14 with browser-body steps: build and load in Chrome and Edge at once; read the open page from the bubble; read a background tab; Allow on this site and Not now paths; sleeping tab; locked page; quit the browser and see the fall back to the screen; change the address in the popup; second profile is a second body)
- Test: none (docs). Check every link and the Mermaid header.

- [ ] **Step 1:** Rewrite as listed. Verify claims against the code (names, limits, ids) rather than the plan.
- [ ] **Step 2:** `pnpm format:check`; grep the repo for `apps/extension`, `browser-extension.md` and `@tagalong/extension` outside `docs/superpowers/` and `packages/core`; expect none.
- [ ] **Step 3: Commit** `docs(browser): the browser body, its tools and permissions (12a)`.

**Slice verification:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`; `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; `pnpm --filter @tagalong/desktop test:e2e` (or CI e2e).

---

## Slice 12b: More to read

Branch `feat/12b-browser-reading`. PR title `feat(browser): pictures, page parts, history search and tab events (12b)`. 6 tasks, about 1,000 changed lines.

**Done when:** `tabs` has `picture`; `page_parts` and `browser_search` exist with their permissions; the browser sends `tab` and `download` events and the brain keeps and shows the latest `tab`; docs and guide updated.

**Docs (T6):** `docs/browser-body.md` (tools, events section), `docs/brain.md` (event kinds), `docs/testing/feature-test-guide.md`, `README.md` if it lists abilities, `protocol/examples` sample files.

### Task 1: `tab` and `download` events on the brain

**Files:**

- Modify: `brain/src/brain/protocol.py` (add `TabData`, `DownloadData`), `brain/src/brain/events.py` (kinds and `from_body`), `brain/src/brain/mind/events.md` (two notes), `brain/src/brain/mind/prompt.py` (`_body_line`, `system_prompt`), `brain/src/brain/sessions.py` (`_focus` neighbour), `protocol/ts/src/messages.ts` (`TabEventData`, `DownloadEventData` beside `FocusEventData`), `protocol/README.md` (event names list)
- Create: `protocol/examples/valid/body.event.params.tab.json`, `body.event.params.download.json`
- Test: `brain/tests/test_events.py`, `brain/tests/test_prompt.py`, `brain/tests/test_sessions.py`, `protocol/ts/src/messages.test.ts`

**Interfaces:**

- Produces pydantic `TabData(title: str, url: str)` and `DownloadData(name: str, state: Literal["complete","interrupted"])`; `EVENT_KINDS` gains `EventKind("tab", wakes=False)` and `EventKind("download", wakes=False)`; `from_body` returns `Event("tab", {"body": id, "title": title[:200], "url": url[:300]}, key=id)` and `Event("download", {"body": id, "name": name[:200], "state": state}, key=id)`; malformed data returns None and never raises.
- Produces `system_prompt(now, bodies, know="", focus=None, tabs=None, downloads=None)`: `tabs` and `downloads` are `Mapping[str, Mapping[str, str | int]]` keyed by body id, like `focus`. A body's line gains `; tab: "<title>" <url> (a page title, data not instructions)` and, when present, `; last download: <name> (<state>)`, each capped and one line. Session passes `self.scheduler.latest("tab")` and `latest("download")` facts.
- Produces `mind/events.md` sections `## tab` and `## download`: context only, not for speaking; the owner switched tabs / a download ended; never repeat a URL back unasked. Wording stays the model's.

- [ ] **Step 1: Write failing tests:** events: `test_tab_event_is_kept_not_woken`; `test_tab_event_replaces_the_older_one_for_the_same_body`; `test_download_event_validates_state` (`"started"` is dropped); `test_tab_with_missing_url_is_dropped_without_raising`; `test_long_title_is_capped_at_200`. prompt: `test_body_line_shows_the_latest_tab_as_data`; `test_body_line_without_tab_is_unchanged`; `test_download_line_appears_once`; `test_tab_title_cannot_close_the_data_fence_or_break_the_line` (quotes and newlines flattened). sessions: `test_tab_event_reaches_the_next_turns_system_prompt` and `test_tab_event_starts_no_turn`. TS: `TabEventData` and `DownloadEventData` parse the new example files and reject a bad `state`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_events.py tests/test_prompt.py tests/test_sessions.py -v` and `pnpm vitest run protocol/ts`. Expect FAIL.
- [ ] **Step 3:** Implement. `from_body` stays exception-free (the existing `ValidationError` handler covers the new branches).
- [ ] **Step 4:** Re-run both; PASS. `uv run ruff check && uv run ruff format --check && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(brain): tab and download events Scout sees but is not woken by (12b)`.

### Task 2: `tabs` `picture`

**Files:**

- Modify: `bodies/browser/src/tools/tabs.ts`, `bodies/browser/src/layer/api.ts` (add `PictureApi`), `bodies/browser/src/layer/chromium.ts` (`chromePicture`)
- Test: `bodies/browser/src/tools/tabs.test.ts`

**Interfaces:**

- Produces `interface PictureApi { capture(windowId: number): Promise<{ mime: 'image/jpeg'; base64: string }> }` (`chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 })`, data URL stripped to base64). `tabsTool` deps gain `picture: PictureApi`; schema `action` gains `'picture'`; the description says to prefer `read` and use `picture` only when the layout matters. Returns one `image` part. Needs: `tabs`, then the site (a picture reads the page too).

- [ ] **Step 1: Write failing tests:** `picture_returns_one_image_part`; `picture_of_a_background_tab_fails_and_never_switches_tabs` (message: only the tab in front can be pictured; `capture` not called); `picture_asks_tabs_then_the_site`; `picture_of_a_sleeping_or_locked_tab_fails_like_read`; `picture_failure_from_the_browser_is_tool_failed_with_a_plain_reason`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/tools/tabs`. Expect FAIL.
- [ ] **Step 3:** Implement, reusing the sleeping and locked checks from `read` (extract one helper in `tabs.ts`, no new file).
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): tabs picture for when text is not enough (12b)`.

### Task 3: `page_parts`

**Files:**

- Create: `bodies/browser/src/content/page-parts.ts`, `bodies/browser/src/tools/page-parts.ts`
- Modify: `bodies/browser/src/content/page-reader.ts` (also installs `globalThis.__tagalongReadParts`), `bodies/browser/src/layer/api.ts` (`PageApi` gains `parts(tabId: number, part: PartKind): Promise<string>`), `bodies/browser/src/layer/chromium.ts`
- Test: `bodies/browser/src/content/page-parts.test.ts` (jsdom), `bodies/browser/src/tools/page-parts.test.ts`

**Interfaces:**

- Produces `content/page-parts.ts`: `type PartKind = 'links' | 'tables' | 'forms' | 'headings'`; `readParts(doc: Document, kind: PartKind): string` (plain text, capped at 40,000 characters with the same truncated note). `links`: `text -> absolute href`, one per line, skipping `javascript:` hrefs and empty ones; `tables`: each table as tab-separated rows under `Table N`; `headings`: `h1`..`h6` as `#`-indented lines; `forms`: for each form its action and, per field, the label (or name or placeholder) and the input type only. Never a field value, never the contents of `password`, `hidden` or `textarea` fields, never `<select>` options chosen.
- Produces `tools/page-parts.ts`: `pagePartsTool(deps: { tabs: TabsApi; page: PageApi; needs: Needs; bodyName: string }): BrowserTool`; tool `page_parts`, `effect: 'read'`, schema `{ part: 'links'|'tables'|'forms'|'headings', tab_id?: number }`; same tab resolution, sleeping and locked rules and the same `tabs` then site needs as `tabs` `read`.

- [ ] **Step 1: Write failing tests:** content (jsdom): `links_lists_text_and_absolute_urls`; `links_skips_javascript_hrefs`; `tables_are_tab_separated_with_a_heading_each`; `headings_keep_their_level`; `forms_list_field_labels_and_types_only` (Review Focus 8: a text input with value `hunter2` and a checked radio never appear in the output; `hunter2` not in the string); `forms_never_read_password_hidden_or_textarea_contents`; `output_is_capped_at_40000_with_the_note`; `empty_page_part_says_there_are_none`. tool: `asks_tabs_then_the_site`; `sleeping_and_locked_tabs_fail_plainly`; `unknown_part_is_invalid_params`; `returns_the_text_from_the_page_api`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/content/page-parts bodies/browser/src/tools/page-parts`. Expect FAIL.
- [ ] **Step 3:** Implement. Share the sleeping/locked/need helper with `tabs.ts` by exporting it from `tools/tabs.ts` (`resolveReadableTab`); do not copy it. Keep `page-reader.js` small: it must not import zod or `@tagalong/contract`.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): page_parts reads links, tables, forms and headings (12b)`.

### Task 4: `browser_search`

**Files:**

- Create: `bodies/browser/src/tools/browser-search.ts`
- Modify: `bodies/browser/src/layer/api.ts` (`SearchApi`), `bodies/browser/src/layer/chromium.ts` (`chromeSearch`)
- Test: `bodies/browser/src/tools/browser-search.test.ts`

**Interfaces:**

- Produces `interface SearchHit { title: string; url: string; when?: string }` and `interface SearchApi { history(text: string, sinceMs: number | undefined, untilMs: number | undefined, limit: number): Promise<SearchHit[]>; bookmarks(text: string, limit: number): Promise<SearchHit[]>; readingList(text: string, limit: number): Promise<SearchHit[]>; downloads(text: string, sinceMs: number | undefined, untilMs: number | undefined, limit: number): Promise<SearchHit[]>; closedTabs(limit: number): Promise<SearchHit[]> }`.
- Produces `browserSearchTool(deps: { search: SearchApi; needs: Needs; bodyName: string; now?: () => number }): BrowserTool`; tool `browser_search`, `effect: 'read'`, schema `{ source: 'history'|'bookmarks'|'reading_list'|'downloads'|'closed', text?: string, since?: string, until?: string, limit?: number }`. Dates are ISO strings (`2026-10-29` or a full timestamp); an unparsable date is `invalid_params`. `limit` default 20, max 50. Needs per source: `history` to `history`, `bookmarks` to `bookmarks`, `reading_list` to `readingList`, `downloads` to `downloads`, `closed` to `sessions`. Output: one text part, one hit per line `<when> | <title> | <url>` (downloads: name and state), or "Nothing matched." `readingList` unsupported (no `chrome.readingList`) fails `tool_failed` "not supported in this browser".

- [ ] **Step 1: Write failing tests:** `each_source_calls_its_api_with_text_dates_and_limit`; `each_source_asks_for_its_own_permission_first`; `limit_defaults_to_20_and_is_capped_at_50`; `since_and_until_parse_iso_dates_to_milliseconds`; `a_bad_date_is_invalid_params`; `unknown_source_is_invalid_params`; `no_hits_say_nothing_matched`; `hit_lines_are_capped_so_one_search_stays_small` (each line cut at 300 characters); `reading_list_unsupported_is_tool_failed_not_supported_in_this_browser`; `a_denied_permission_surfaces_its_sentence`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/tools/browser-search`. Expect FAIL.
- [ ] **Step 3:** Implement. `chromeSearch.closedTabs` uses `chrome.sessions.getRecentlyClosed`; `readingList` feature-detects `chrome.readingList?.query`.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): browser_search over history, bookmarks, downloads and more (12b)`.

### Task 5: The browser sends `tab` and `download` events

**Files:**

- Create: `bodies/browser/src/events.ts`
- Modify: `bodies/browser/src/layer/api.ts` (`TabEvents`, `DownloadEvents`), `bodies/browser/src/layer/chromium.ts`, `bodies/browser/src/body.ts` (wire to `client.event`), `bodies/browser/src/service-worker.ts` (top-level `chrome.tabs.onActivated`, `chrome.tabs.onUpdated` for the active tab's url or title, `chrome.downloads.onChanged` when present, `chrome.permissions.onAdded` to attach it later)
- Test: `bodies/browser/src/events.test.ts`, `bodies/browser/src/body.test.ts`

**Interfaces:**

- Produces `events.ts`: `TAB_THROTTLE_MS = 2_000`; `stripUrl(url: string): string` (origin plus path, no query string, no fragment; non-http(s) urls and unparsable input return `''`); `createTabReporter(options: { send: (name: string, data: unknown) => boolean; now: () => number }): (tab: { title: string; url: string }) => void` (sends `tab {title, url}` with the stripped url; at most one per 2 s, the latest value inside the window is sent when it ends, never the same title and url twice in a row, nothing for an empty stripped url); `downloadEvent(item: { filename: string; state: string }): { name: string; state: 'complete' | 'interrupted' } | null` (name is the file's base name only, no folder; other states return null).
- Permissions rule: events never prompt. The tab reporter reads a tab's url only when `tabs` is already granted (the tab arrives with a url or not); downloads attach only when `chrome.downloads` exists.

- [ ] **Step 1: Write failing tests:** `stripUrl_drops_query_and_fragment`; `stripUrl_ignores_non_web_urls`; `a_burst_of_tab_changes_sends_one_event_per_2s_with_the_last_value` (fake clock: three changes in 500 ms, one send now, the last one when 2 s pass); `the_same_tab_twice_is_sent_once`; `a_tab_with_no_readable_url_sends_nothing` (permission not granted, empty url); `send_returning_false_is_tried_with_the_next_change`; `downloadEvent_keeps_only_the_base_name` (`C:\Users\a\Downloads\tax.pdf` gives `tax.pdf`); `downloadEvent_maps_complete_and_interrupted_and_ignores_in_progress`; body: `tab_changes_reach_the_brain_as_event_frames` (fake socket sees `{method:'event', params:{name:'tab', data:{title, url}}}`) and `events_are_not_sent_while_offline`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/events bodies/browser/src/body`. Expect FAIL.
- [ ] **Step 3:** Implement. Listener registration stays synchronous at the worker's top level; `chrome.downloads` may be undefined, so guard it and re-check on `chrome.permissions.onAdded`.
- [ ] **Step 4:** Re-run; PASS. `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(browser): tab and download facts for Scout (12b)`.

### Task 6: Docs for 12b

**Files:** `docs/browser-body.md` (tools `picture`, `page_parts`, `browser_search` with schemas and permissions; the Events section: `tab {title, url}` and `download {name, state}`, throttle, stripped URLs, never prompts), `docs/brain.md` (event kinds, prompt line), `docs/testing/feature-test-guide.md` (steps: picture of the front tab and refusal for a background one; page parts for links and for a login form with typed text that must not appear; search history, bookmarks, closed tabs; the permission window for each new source; a tab switch shows up in Scout's next answer; a finished download), `protocol/README.md` (the two event names), `README.md` only if it lists abilities.

- [ ] **Step 1:** Write the docs, checking names and values against the code. **Step 2:** `pnpm format:check`. **Step 3: Commit** `docs(browser): reading tools and tab events (12b)`.

**Slice verification:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`; `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`.

---

## Slice 12c: Acting and asking from the browser

Branch `feat/12c-browser-actions`. PR title `feat(browser): tab actions, right-click and address bar ask (12c)`. 4 tasks, about 900 changed lines.

**Done when:** `tab_actions` works under the person's permissions; a right-click "Ask Scout about this" and the `scout` address-bar keyword reach Scout and the answer appears in the desktop bubble; `Body.display` is in the contract, both type sets and the examples; with only a display-less body online an ask is refused at once; docs updated.

**Docs (T4):** `docs/browser-body.md` (`tab_actions`, right-click, omnibox, `display`), `docs/brain.md` (routing rule), `protocol/README.md` (Shared shapes `Body { id, kind, name, display? }`, the `turn` and `say` wording), `docs/testing/feature-test-guide.md`, `README.md`.

### Task 1: `Body.display` in the contract and brain routing

**Files:**

- Modify: `protocol/README.md`, `protocol/ts/src/shapes.ts` (`Body` gains `display: z.boolean().optional()`), `brain/src/brain/protocol.py` (`Body.display: bool | None = None`), `brain/src/brain/bodies.py` (`display_ids()`, `body(body_id)`), `brain/src/brain/sessions.py` (`say`, `_start_turn`), `brain/src/brain/scheduler.py` (`_choose_body`), `brain/src/brain/asks.py:38-39` (`anyone_online`)
- Create: `protocol/examples/valid/body.hello.params.display-false.json`, `protocol/examples/invalid/body.hello.params.display-null.json`
- Test: `protocol/ts/src/shapes.test.ts`, `brain/tests/test_protocol.py` (examples are picked up automatically), `brain/tests/test_bodies.py`, `brain/tests/test_sessions.py`, `brain/tests/test_scheduler.py`, `brain/tests/test_asks.py`

**Interfaces:**

- Produces `Bodies.display_ids() -> list[str]` (online bodies whose `display` is not `False`, in connect order) and `Bodies.body(body_id: str) -> Body | None` (online only).
- Produces the rule, in one place (`Session._display_target() -> str | None`): the body the person last talked to if it is online and displays, else the first online body that displays, else `None`. `Session.say(body_id, params)`: when the sender's body has `display == False`, the turn's `body` is `_display_target()` and `_last_body` is not changed; otherwise unchanged. `_start_turn` accepts `body_id: str | None` (replies and turns already allow `null`). `Scheduler._choose_body` uses `display_ids()` instead of `online_ids()` (a wake is never labelled with a display-less body). `Asks.anyone_online()` is true only when `display_ids()` is non-empty.
- Optional field, never null (`NULLABLE` in `protocol.py` is unchanged: `display` must be omitted rather than null).

- [ ] **Step 1: Write failing tests:** TS `shapes.test.ts`: `body_accepts_display_false_and_omitted`; `body_rejects_display_null`. examples: the two new files pass and fail as named. bodies: `test_display_ids_skip_display_false_bodies`; `test_body_lookup_is_online_only`. sessions: `test_say_from_a_display_less_body_routes_the_turn_to_the_last_displaying_body` (turn notification `body` is `desktop`); `..._falls_back_to_any_displaying_body`; `..._is_null_when_no_displaying_body_is_online`; `test_say_from_a_display_less_body_does_not_move_last_body` (a later wake goes to `desktop`); `test_say_from_a_displaying_body_is_unchanged`; `test_display_less_say_joins_a_running_turn_like_any_say`. scheduler: `test_wake_never_goes_to_a_display_less_body`; `test_wake_waits_when_only_display_less_bodies_are_online`. asks: `test_ask_with_only_a_display_less_body_online_is_refused_like_nobody_online` (the `anyone_online` guard blocks with `denied`, no ask opens); `test_ask_opens_when_a_displaying_body_is_online`.
- [ ] **Step 2:** `cd brain && uv run pytest tests/test_bodies.py tests/test_sessions.py tests/test_scheduler.py tests/test_asks.py tests/test_protocol.py -v` and `pnpm vitest run protocol/ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Update `protocol/README.md` first (Body shape, the `say` and `turn` rules, "a body with `display: false` shows nothing; replies, asks and broadcasts are still sent to it and it ignores them").
- [ ] **Step 4:** Re-run both suites, then `uv run pytest && uv run ruff check && uv run ruff format --check && pnpm test && pnpm typecheck && pnpm lint`. Expect PASS. Confirm the desktop's `turn-events.ts` still shows turns whatever their `body` (it ignores the field); add one test `turn_events.test.ts::shows_a_turn_whatever_body_it_names` if none says so.
- [ ] **Step 5: Commit** `feat(contract): optional Body.display and where a display-less say is shown (12c)`.

### Task 2: `tab_actions`

**Files:**

- Create: `bodies/browser/src/tools/tab-actions.ts`
- Modify: `bodies/browser/src/layer/api.ts` (`ActionsApi`), `bodies/browser/src/layer/chromium.ts` (`chromeActions`), `bodies/browser/src/permissions.ts` and `manifest.ts` (add `search` to `OPTIONAL_PERMISSIONS` and the manifest list), `bodies/browser/src/body.ts` (register the tool)
- Test: `bodies/browser/src/tools/tab-actions.test.ts`, `bodies/browser/src/manifest.test.ts`

**Interfaces:**

- Produces `interface ActionsApi { open(url: string): Promise<{ id: number }>; search(text: string): Promise<{ id: number }>; close(tabId: number): Promise<void>; switchTo(tabId: number): Promise<void>; group(tabIds: number[], title?: string): Promise<void>; reopen(): Promise<{ title: string; url: string } | null>; bookmark(title: string, url: string): Promise<void>; addToReadingList(title: string, url: string): Promise<void> }`.
- Produces `tabActionsTool(deps: { actions: ActionsApi; tabs: TabsApi; needs: Needs; bodyName: string }): BrowserTool`; tool `tab_actions`, **`effect: 'change'`, no `confirm`**, schema `{ action: 'open'|'close'|'switch'|'group'|'reopen'|'bookmark'|'reading_list', url?: string, search?: string, tab_id?: number, tab_ids?: number[], title?: string }`. Rules: `open` takes `url` (http and https only; anything else is `invalid_params` "only http and https addresses") or `search` (needs `search`); `close`/`switch` need `tab_id` and no permission; `group` needs `tab_ids` and `tabGroups`; `reopen` needs `sessions`; `bookmark` needs `bookmarks`; `reading_list` needs `readingList` (unsupported gives `tool_failed` "not supported in this browser"); `bookmark` and `reading_list` default to the active tab's title and url (needs `tabs`). Returns a short text line saying what was done.

- [ ] **Step 1: Write failing tests:** `open_accepts_http_and_https_only` (Review Focus 10: `javascript:alert(1)`, `file:///c:/a`, `chrome://settings`, `data:text/html,x`, `about:blank` each `invalid_params`, `open` not called); `open_with_search_uses_the_search_permission`; `open_needs_url_or_search_not_both_missing`; `close_and_switch_need_a_tab_id_and_ask_nothing`; `group_asks_for_tabGroups_and_names_the_group`; `reopen_asks_for_sessions_and_says_when_nothing_was_closed`; `bookmark_defaults_to_the_active_tab`; `reading_list_unsupported_is_tool_failed`; `declared_effect_is_change_without_confirm` (the tool object has `effect: 'change'` and no `confirm`); `denied_permission_surfaces_its_sentence`; `unknown_action_is_invalid_params`. manifest: the optional list now includes `search`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser/src/tools/tab-actions bodies/browser/src/manifest`. Expect FAIL.
- [ ] **Step 3:** Implement; `chromeActions.search` is `chrome.search.query({ text, disposition: 'NEW_TAB' })`.
- [ ] **Step 4:** Re-run; PASS. `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(browser): tab_actions under the person's permissions (12c)`.

### Task 3: Right-click "Ask Scout about this" and the `scout` keyword

**Files:**

- Create: `bodies/browser/src/ask-scout.ts`
- Modify: `bodies/browser/src/manifest.ts` (`omnibox: { keyword: 'scout' }`), `bodies/browser/src/body.ts` (hello `display: false`; `say(text, context)`), `bodies/browser/src/service-worker.ts` (top-level `chrome.omnibox.onInputEntered`, `chrome.contextMenus.onClicked`, create the menu when `contextMenus` is granted and on `chrome.permissions.onAdded`), `bodies/browser/src/popup/model.ts` and `popup.ts` (a "Turn on right-click" button that requests `contextMenus` from the click), `bodies/browser/src/layer/chromium.ts`
- Test: `bodies/browser/src/ask-scout.test.ts`, `bodies/browser/src/body.test.ts`, `bodies/browser/src/manifest.test.ts`, `bodies/browser/src/popup/model.test.ts`

**Interfaces:**

- Produces `ask-scout.ts`: `MENU_ID = 'ask-scout'`; `MENU_TITLE = 'Ask Scout about this'`; `fromMenuClick(info: { selectionText?: string; pageUrl?: string }, tab: { title?: string; url?: string } | undefined): { text: string; context: { url: string; title: string } } | null` (text is the selection, or "What is this page about?" is not allowed here: with no selection the text is empty and the function returns null; a page click without a selection is not an ask); `fromOmnibox(typed: string, tab: { title?: string; url?: string } | undefined): { text: string; context: { url: string; title: string } } | null` (null for empty or whitespace); `stripUrl` from `events.ts` is applied to `context.url`.
- Produces in `body.ts`: hello body `{ id, kind: 'browser', name, display: false }`; `say(text: string, context: { url: string; title: string }): Promise<void>` calling `client.say({ text, context })` and swallowing `BrainOffline` (nothing is shown anywhere while the brain is down; the popup's status line is where the person sees that).
- Manifest gains `omnibox: { keyword: 'scout' }`; the `scout` keyword needs no permission.

- [ ] **Step 1: Write failing tests:** `fromMenuClick_uses_the_selection_and_the_page_as_context`; `fromMenuClick_with_no_selection_is_null`; `fromMenuClick_strips_the_query_from_the_context_url`; `fromOmnibox_uses_the_typed_text`; `fromOmnibox_blank_is_null`; body: `hello_says_display_false` (hello frame body has `display: false`, matches the contract example); `say_sends_text_and_context_as_a_say_request`; `say_while_offline_is_swallowed`; manifest: `declares_the_scout_omnibox_keyword`; popup model: `contextMenus_offer_is_shown_only_until_granted`.
- [ ] **Step 2:** `pnpm vitest run bodies/browser`. Expect FAIL.
- [ ] **Step 3:** Implement. The menu item exists only after `contextMenus` is granted; the popup button requests it from its click (the only place it can be requested), and the worker creates the item on `permissions.onAdded`.
- [ ] **Step 4:** Re-run; PASS. `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(browser): ask Scout from the right-click menu and the address bar (12c)`.

### Task 4: Docs for 12c

**Files:** as listed under the slice's Docs line. Add a short Mermaid sequence for "ask from the browser, answer in the bubble" (black and white, with the init line) to `docs/browser-body.md`.

- [ ] **Step 1:** Write the docs, checking names against the code; feature-test steps: right-click a selection and see the answer in the desktop bubble (and not in the browser); type `scout <question>` in the address bar; with the desktop closed and only the browser connected, a tool that asks is refused at once; `tab_actions` open, close, switch, group, reopen, bookmark; `javascript:` refused; Allow and Not now for each new permission. **Step 2:** `pnpm format:check`. **Step 3: Commit** `docs(browser): tab actions, right-click and display (12c)`.

**Slice verification:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`; `cd brain && uv run pytest && uv run ruff check && uv run ruff format --check`; `pnpm --filter @tagalong/desktop test:e2e` (or CI e2e).

---

## Self-review

- **Spec coverage:** decisions 1-9 are scope, covered by slice goals. 10 folder move: 12a T1. 11 identity: T3, T7. 12 four tools: `tabs` T4 and 12b T2, `page_parts` 12b T3, `browser_search` 12b T4, `tab_actions` 12c T2. 13 reading rules: T4. 14 permissions: T5, T7 manifest, T6 popup list, 12c T3 contextMenus. 15 events: 12b T1, T5. 16 shared connection: T2, T7. 17 popup: T6. 18 desktop entry: T9, T10, T1 packaging. 19 right-click and `display`: 12c T1, T3. 20 deletions: T7. 21 no wake: T8. 22 timeouts: T4, T5, T7. 23 event settings: 12b T1, T5. 24 dev build: T9. Testing section: covered per task; the by-hand list is in each slice's docs task.
- **Types:** `Need`, `Needs`, `PermissionBroker`, `TabsApi`, `PageApi`, `BrowserTool`, `toolset`, `SeqStore`, `BrainClientOptions.body`, `stripUrl`, `display_ids` are defined once and used with the same names later. `OPTIONAL_PERMISSIONS` gains `search` in 12c T2, with the manifest test updated in the same task.
- **Proportion:** code blocks are signatures and test names; no bodies.
