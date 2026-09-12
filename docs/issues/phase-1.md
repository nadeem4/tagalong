# Phase 1 issue log

Every error hit while building Phase 1, including the ones already recovered from.

### 1. The main process died on the first WebSocket frame: `bufferUtil.unmask is not a function`

- **Symptom:** `npx playwright test` reported `Error: no avatar window appeared; saw ` for
  every window test, and `app.close()` timed out in `afterEach` ("Worker teardown timeout
  of 60000ms exceeded"). Launching the built app by hand showed no console output at all
  and a native window titled `Error`, whose text was:

  ```
  A JavaScript error occurred in the main process
  Uncaught Exception:
  TypeError: bufferUtil$1.unmask is not a function
      at bufferUtil.exports.unmask (file:///C:/ai_pet/apps/desktop/dist/main.js:19778:27)
      at Receiver.getData (.../dist/main.js:20835:11)
      at Receiver.startLoop (.../dist/main.js:20583:18)
      at Receiver._write (.../dist/main.js:20521:12)
      at Socket.socketOnData (.../dist/main.js:22798:37)
  ```

- **Root cause:** `ws` is bundled into `dist/main.js` (workspace packages are bundled, and
  `ws` comes along with them). `ws` reaches for two optional native addons, `bufferutil`
  and `utf-8-validate`, inside a `try`/`catch` and depends on `require()` _throwing_ when
  they are absent so it can keep its pure-JS `mask`/`unmask`. Vite does not let the
  require throw: it substitutes an empty object for an absent optional peer dependency
  (`const __viteOptionalPeerDep_bufferutil_ws_true = {};`). The `try` therefore succeeds
  and `ws` installs wrappers that call `bufferutil.unmask(...)`, which is `undefined`.
  The crash only fires when a _masked_ frame of 32 bytes or more arrives — i.e. the first
  real request the host sends the engine — which is why a `netstat` check looked healthy:
  the listener binds, the socket connects and the handshake completes before anything
  breaks. Electron's default uncaught-exception handler then opened a **modal** error
  dialog, which blocks the main process event loop; that is why `app.close()` hung, and
  why the hung instance kept the single-instance lock and made every later launch in the
  suite quit immediately with zero windows.
- **Fix:** `apps/desktop/electron.vite.config.ts` — added `define` to the `main` build
  setting `process.env.WS_NO_BUFFER_UTIL` and `process.env.WS_NO_UTF_8_VALIDATE` to
  `"1"`. `ws` checks those before it tries the addons, so it stays on the JS path and the
  stub is dead-code-eliminated (`__viteOptionalPeerDep` count in the bundle: 8 -> 0).
- **Impact on the plan:** None for the phase's acceptance criteria, but it is a genuine
  product bug, not a test-only one: **the shipped app could not answer a single question**
  — the very first `ask` killed the main process. The e2e test is what caught it, which is
  the argument for having it.

### 2. The launch assertion ran before the windows existed

- **Symptom:** After fixing #1 the first test still failed:

  ```
  Error: expect(received).toContain(expected) // indexOf
  Expected substring: "avatar.html"
  Received string:    ""
  ```

- **Root cause:** Test bug. `app.evaluate` was called the instant `electron.launch`
  resolved, but `launch` resolves when the main process is reachable, not when the app has
  finished starting. `start()` awaits `Engine.boot` before it creates any window, so
  `BrowserWindow.getAllWindows()` was legitimately empty.
- **Fix:** The test waits for the avatar window via the polling helper _first_, and only
  then evaluates in main to assert the window pair. The assertion it replaced was worse
  than wrong — the original `boots the engine on loopback` test read
  `globalThis.__tagalongPort ?? 47321` (a global the app never sets) and compared the
  result to `47321`, so it asserted its own fallback and passed whether or not the engine
  was running. That is precisely why the suite reported "1 passed" while the app was dead.
- **Impact on the plan:** none.

### 3. `[data-role="assistant"]` also matches the in-flight streaming bubble

- **Symptom:** No observed failure — found by reading the UI before trusting the selector.
  The "turn completed" assertion would have passed while the answer was still streaming,
  so a green test would have proved less than the acceptance criteria claim.
- **Root cause:** Latent test bug. `packages/ui/src/message-list.tsx` renders the
  streaming bubble with **both** `data-testid="streaming-message"` and
  `data-role="assistant"`, so `[data-role="assistant"]` does not select a _settled_
  message.
- **Fix:** The completion assertion targets
  `[data-role="assistant"]:not([data-testid="streaming-message"])` and additionally waits
  for the streaming bubble to reach count 0, so it can only pass on a completed turn.
- **Impact on the plan:** none.

### 4. CI wiring: no xvfb needed, but the job needs a cap

- **Symptom:** None yet — this is the decision, recorded so the reasoning is not lost.
- **Root cause:** The brief suggested `xvfb`-style guarding for a headless runner, but
  `.github/workflows/ci.yml` runs on `windows-latest`, which has an interactive desktop
  session. Electron opens real windows there, so `xvfb-run` is both unavailable and
  unnecessary; adding a Linux branch would be dead code in a Windows-only job.
- **Fix:** `.github/workflows/ci.yml` gained a `Smoke test (Electron end-to-end)` step
  after `Build`, running `pnpm --filter @tagalong/desktop test:e2e`, with
  `timeout-minutes: 10`. The cap is the anti-flake measure that matters here: issue #1
  showed that a main-process crash produces a _modal_ dialog which blocks the event loop,
  so without a cap that failure mode hangs the job for the full six-hour default instead
  of failing it. `apps/desktop/package.json`'s `test:e2e` also now runs
  `scripts/ensure-electron.mjs` first, so the step does not depend on an earlier step
  having fetched the Electron binary.
- **Impact on the plan:** None. "CI runs the smoke test" is satisfied on the existing
  Windows runner and the step is not conditional, so it cannot silently skip. If Phase 7
  adds macOS/Linux runners, the Linux one _will_ need `xvfb-run` around this step.

### 5. `productName` is unset, so user data lands in `%APPDATA%\@tagalong\desktop`

- **Symptom:** `app.getPath('userData')` resolves to
  `C:\Users\<user>\AppData\Roaming\@tagalong/desktop` — the scoped package name, complete
  with a forward slash, used as a directory path.
- **Root cause:** `apps/desktop/package.json` has no `productName`, so Electron falls back
  to `name`, which is `@tagalong/desktop`.
- **Fix:** None made — out of scope for this task, recorded so it is not rediscovered.
- **Impact on the plan:** Cosmetic today. It should be set before any packaging or
  auto-update work, because changing it later strands every existing user's settings,
  secrets and SQLite database in the old directory.

### 6. `pnpm format:check` is already red, so CI never reaches the new smoke step

- **Symptom:** `npx prettier --check .` fails on five files none of this task touched:

  ```
  [warn] apps/desktop/src/main/index.ts
  [warn] apps/desktop/src/main/platform/selection.test.ts
  [warn] apps/desktop/src/main/secret-store.test.ts
  [warn] apps/desktop/src/renderer/src/app.css
  [warn] apps/desktop/src/renderer/src/settings.tsx
  Code style issues found in 5 files.
  ```

- **Root cause:** Pre-existing drift from an earlier task. The `Format check` step runs
  third in `.github/workflows/ci.yml`, before `Build`, so the job stops there and the new
  `Smoke test` step never runs.
- **Fix:** None made — these are unrelated files outside this task's scope, and silently
  reformatting five source files would hide the drift rather than report it. `pnpm format`
  fixes all five.
- **Impact on the plan:** Blocking. "CI runs the smoke test" is not actually true until
  this is fixed, even though the step is wired correctly and passes locally.

### 7. A red PR was merged, and `main` was broken for four minutes

- **Symptom:** PR #3's CI build failed. It was merged anyway on the assumption that it
  would pass, so `main` carried a failing build until PR #4 landed about four minutes
  later.
- **Root cause:** Nothing enforced the check. The `build` status was advisory, and the
  merge decision was left to judgement.
- **Fix:** Branch protection on `main` now requires the `build` check, with strict mode
  (the branch must be up to date before merging) and `enforce_admins` on. The rule is
  enforced by GitHub rather than by discipline.
- **Impact on the plan:** None. It changes the process, not the work.

### 8. `gyp ERR! could not find a version of Visual Studio 2017 or newer` in CI

- **Symptom:** `pnpm install` in CI failed while building `better-sqlite3`, with node-gyp
  reporting that it could not find a usable Visual Studio installation.
- **Root cause:** `better-sqlite3` had been added to `pnpm.onlyBuiltDependencies`. That
  allowlist makes pnpm run a build for the package, and since the package has no install
  script, pnpm falls back to `node-gyp rebuild` — compiling from source something that
  never needed compiling. `better-sqlite3` ships N-API prebuilds for all eight platforms,
  win32-x64 included. The runner compounded it: it has Visual Studio **18**, which
  node-gyp 11.5.0 cannot parse, so even the fallback could not have succeeded.
- **Fix:** Removed `better-sqlite3` from the allowlist and recorded it under
  `pnpm.ignoredBuiltDependencies` instead, so the prebuild is used.
- **Impact on the plan:** **Phase 0's prerequisite list is wrong.** The Visual Studio C++
  workload and Python 3 are not required — not for task #13, and not for anything built so
  far.

### 9. 33 typecheck errors: `Property 'toHaveTextContent' does not exist`

- **Symptom:** `tsc` reported 33 errors of the form
  `Property 'toHaveTextContent' does not exist` across the `packages/ui` tests, which had
  been typechecking cleanly.
- **Root cause:** pnpm resolved a different physical copy of `vitest` for
  `@testing-library/jest-dom` than the one the test files imported. jest-dom extends the
  matcher types with `declare module 'vitest'`, and module augmentation only applies to the
  module instance it names, so with two copies on disk the augmentation silently did not
  reach the tests. It appeared only after an unrelated dependency install reshuffled peer
  resolution — nothing in the tests or in jest-dom had changed.
- **Fix:** `packages/ui` declares `vitest` directly, so it and jest-dom resolve one copy.
- **Impact on the plan:** none.

### 10. A verification that could not fail

- **Symptom:** The typecheck was reported as passing while it was in fact failing.
- **Root cause:** The check was run as
  `npx tsc -p tsconfig.tests.json | head -5 && echo OK`. A pipeline's exit status is that
  of its last command, and `head` always exits 0, so `OK` printed whether or not `tsc`
  succeeded. A genuine failure was read as a pass.
- **Fix:** Exit codes are checked directly — `cmd; echo EXIT=$?` — never through a pipe.
- **Impact on the plan:** None, but it is why issue 9 went unnoticed for a while.

### 11. The Electron binary was never downloaded

- **Symptom:** `pnpm install` completed, but `apps/desktop/node_modules/electron/dist` did
  not exist, so nothing could launch.
- **Root cause:** Electron 44.3.0 publishes no install script at all —
  `npm view electron@44.3.0 scripts` prints nothing. That script is what fetches the
  ~246 MB binary, so with no script there is nothing for pnpm to run, and no pnpm build
  allowlist entry helps.
- **Fix:** `apps/desktop/scripts/ensure-electron.mjs` resolves the electron package and
  runs its `install.js` when `dist/` is missing. It is wired into the desktop `build`,
  `dev`, `start` and `test:e2e` scripts, so any entry point fetches the binary once.
- **Impact on the plan:** none.

### 12. `electron-vite` 5 and `vitest` 5 want different major versions of Vite

- **Symptom:** One hoisted Vite could not satisfy both: electron-vite peers on vite ^5–7,
  and vitest 5 pulls vite 8.
- **Root cause:** The two tools sit on opposite sides of the Vite 8 release.
- **Fix:** `apps/desktop` pins vite 7 and pnpm keeps the two copies apart.
- **Impact on the plan:** A consequence worth recording: `@vitejs/plugin-react` 6.1.1
  imports `vite/internal`, which exists only in Vite 8, so the React plugin was dropped in
  favour of `esbuild: { jsx: 'automatic' }`. **Development loses Fast Refresh** until
  electron-vite supports Vite 8.

### 13. The app would not launch: `ERR_MODULE_NOT_FOUND` on extensionless imports

- **Symptom:** The desktop main process exited immediately with `ERR_MODULE_NOT_FOUND` for
  a relative import inside a workspace package.
- **Root cause:** `packages/{protocol,core,ui}` compile with `moduleResolution: bundler`,
  as the Phase 0 page specifies, and TypeScript emits relative imports exactly as written —
  with no file extension. Node's ESM loader cannot resolve those. It had not surfaced
  before because every consumer so far was a bundler or vitest; the desktop host was the
  first real Node consumer.
- **Fix:** electron-vite bundles the workspace packages instead of externalizing them, so
  Rollup resolves those imports at build time. Only the genuinely native dependencies
  (`better-sqlite3`, `get-windows`) stay external, and they are declared as desktop
  dependencies so they resolve at runtime.
- **Impact on the plan:** Every future Node consumer of these packages meets the same wall
  and needs the same answer.

### 14. Vitest collected the Playwright spec

- **Symptom:** `pnpm test` failed with "Playwright Test did not expect
  test.describe.configure() to be called here."
- **Root cause:** Vitest's default glob matches `*.spec.ts`, so
  `apps/desktop/e2e/smoke.spec.ts` was collected by vitest and its Playwright APIs ran
  outside a Playwright runner.
- **Fix:** `apps/desktop/vitest.config.ts` excludes `e2e/**`.
- **Impact on the plan:** none.

### 15. Documentation had drifted ahead of the code

- **Symptom:** While updating the docs, several documented claims turned out not to be true
  of the current build:
  - memory has no FTS5 index yet — that is Phase 4 task #45;
  - `SttProvider` and `TtsProvider` do not exist yet — Phase 3;
  - `.env.local`'s `ANTHROPIC_API_KEY` is **not** how the app reads the key. It comes from
    the safeStorage-backed `SecretStore` via the Settings window, and
    `TAGALONG_FAKE_PROVIDERS` is the only variable actually read from the environment;
  - the desktop host advertises only the `selection`, `activeWindow` and `clipboard`
    capabilities.
- **Root cause:** The docs were written from the plan rather than from the code, so they
  described the intended end state as the present one.
- **Fix:** README and `docs/architecture.md` corrected to describe what is built.
- **Impact on the plan:** `.env.example` still lists voice and Anthropic keys that nothing
  reads yet. Harmless, but worth knowing they are aspirational.

### 16. The smoke test asserted a transient UI state, and CI caught it

- **Symptom:** `Smoke test (Electron end-to-end)` passed on every local run and failed on the
  Windows CI runner with `element(s) not found — Expect "toBeVisible"
getByTestId('streaming-message') with timeout 15000ms`. The assertion immediately before
  it — the question echoed back as `[data-role="user"]` — passed, so the ask reached the
  engine and the renderer updated. Only the transient streaming bubble was missed.
- **Root cause:** `streaming-message` is ephemeral by design: `MessageList` renders it only
  while `streamingText` is non-empty, which is the window between the first `turn.delta` and
  `turn.completed`. `FakeBrainProvider` streams with `delayMs` defaulting to `0` and
  `createProvider` never sets it, so the whole scripted answer streams in a few milliseconds
  and the bubble can come and go between two Playwright polls. Asserting that an
  intermediate state was _seen_ is racy by construction — the test was not detecting a
  regression, it was betting on scheduler timing, and a loaded CI runner lost the bet.
- **Fix:** `apps/desktop/e2e/smoke.spec.ts` no longer requires the streaming bubble to be
  observed. It still asserts the user echo, then the settled end state: an assistant message
  that is not the streaming bubble appears, is not empty, and no streaming bubble remains.
  The streaming behaviour itself is covered where it can be driven deterministically —
  `packages/ui/src/chat-panel.test.tsx` pushes `turn.delta` events through a fake bridge and
  asserts the text grows `A fox` → `A fox is a` → `A fox is a small canid.` before
  `turn.completed` settles it. No timeout was raised, no retry added, and no delay was put
  into production code to make a test easier.
- **Impact on the plan:** a rule for the end-to-end suite going forward — it asserts settled,
  observable states; anything transient belongs in the unit tests, where the events are
  driven rather than awaited.

## What this phase changed about the plan

Most of the issues above cost time and changed nothing. Four of them changed the plan:

1. **The Visual Studio C++ workload and Python 3 are not needed.** `better-sqlite3` ships
   N-API prebuilds, so Phase 0's prerequisite list and its open item can be dropped
   (issue 8).
2. **`productName` must be set before any packaging or auto-update work.** Changing it
   later strands every existing user's settings, secrets and database in the old directory
   (issue 5).
3. **Development has no Fast Refresh** until electron-vite supports Vite 8. Renderer
   changes need a reload (issue 12).
4. **`moduleResolution: bundler` means these packages cannot be consumed by bare Node.**
   Every future Node consumer must bundle them, or the emit must change (issue 13).
