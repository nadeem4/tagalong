# Developer guide

How to build, run, test and package Tagalong from source, and the conventions the code follows. For how it works inside, start at [architecture.md](architecture.md); the [docs index](README.md) lists every subsystem doc.

## Repository layout

A pnpm workspace monorepo. One Python brain, many thin TypeScript bodies.

```text
tagalong/
  package.json                      # pnpm workspace root (private)
  pnpm-workspace.yaml
  tsconfig.base.json                # plus tsconfig.json and tsconfig.tests.json
  vitest.config.ts                  # projects: bodies/*, protocol/ts; coverage thresholds
  eslint.config.js
  .github/workflows/ci.yml          # changes, build (Linux), brain (Linux), e2e (Windows)
  docs/
    README.md                       # the index and reading order
    architecture.md                 # the whole system
    desktop.md, bubble.md, voice.md, browser-body.md   # the hosts
    sight.md, memory.md, connected-apps.md, brain.md   # the subsystems
    settings-and-secrets.md, privacy.md, development.md
    testing/feature-test-guide.md   # manual tests
    chrome-web-store/               # store listing kit and the extension's privacy policy
  protocol/                         # contract v1 for the Python brain (README.md is the spec)
    examples/                       # sample frames shared by the TypeScript and Python tests
    ts/                             # @tagalong/contract: zod schemas for contract v1
  brain/                            # the Python brain: uv project, tests/; src/brain/ has protocol.py,
                                    # config.py, bodies.py, server.py, apps.py, app_tools.py and
                                    # main.py (see docs/brain.md)
  bodies/
    ui/src/
      index.ts, host-bridge.ts      # HostBridge contract and its React context
      shapes/                       # @tagalong/ui/shapes, React-free: addressing, apps, context, memory,
                                    # pet, status, turn-events, voice (also imported by desktop main)
      dock-pet.tsx, companion-bubble.tsx
      connector-confirm.tsx, drop-card.tsx,
      health-card.tsx, status-mark.tsx, answer.tsx
      home/                         # Home: HomeView and its pages (Overview, Jobs, Connections, Approvals,
                                    # What Scout remembers, Settings, Spend)
      settings/settings-styles.ts   # the Settings sheet's styles
      voice/                        # push to talk, the listen controller, the speech queue, what is spoken aloud
      theme/                        # design tokens, BeanClip (a strip of Bean frames, moving or still)
      test-support/fake-host-bridge.ts
    desktop/
      electron.vite.config.ts       # main / preload / renderer builds
      playwright.config.ts
      electron-builder.json         # installer config: NSIS (Windows), dmg, AppImage, deb
      scripts/ensure-electron.mjs   # fetches the Electron binary
      scripts/fetch-native.mjs      # fetches get-windows' prebuilt binding before packaging
      scripts/start-fresh.mjs       # runs the app on a new temp data folder
      e2e/                          # smoke, brain-offline, hotkey-recovery, listening
                                    # (Always listening), asks, permissions and jobs.spec.ts
                                    # (Home's Jobs panel and a job's asks)
      e2e/fixtures/fake-brain.ts    # a ws server speaking contract v1, for smoke, listening, asks, permissions, jobs
      src/main/                     # index.ts, brain/ (turn-events.ts,
                                    # start.ts), context.ts,
                                    # hotkeys.ts, talk-key.ts, always-listening.ts,
                                    # tray-icon.ts, tray-menu.ts,
                                    # sight-pause.ts, drop.ts, settings-store.ts, hide-secrets.ts,
                                    # log-file.ts, ipc/,
                                    # platform/, windows/
      src/main/platform/            # capture, downscale, ocr,
                                    # read-text, text-layer, sight-gate,
                                    # window-helper, window-list, window-shot, selection, win32
      src/main/windows/             # one module per window: avatar, panel, home
      src/preload/index.ts          # exposes window.tagalong and window.tagalongHost
      src/renderer/                 # avatar (Scout), panel (the bubble),
                                    # and home (Home) HTML, src/*.tsx
      src/renderer/src/settings/    # the Settings page, one file per section
      src/renderer/src/bean/        # Bean's WebP strips and manifest.json
      src/renderer/src/bean-assets.ts # FIGURE: the strips bundled once for the dock and Home
      scripts/bean/                 # bean.py (Blender) and pack.py: regenerate Bean's strips
      src/shared/ipc.ts             # IPC channel names and the host-only API type
      src/shared/                   # settings.ts (Settings schema and defaults), blind-spots.ts, voice.ts
    browser/                        # browser body (Chromium MV3), built by Vite into dist/ (load unpacked)
      src/manifest.ts               # the manifest as data; the build writes dist/manifest.json
      src/body.ts, identity.ts      # the body: one BrainClient, tools, body id <browser>-<4 chars>
      src/tools/, permissions.ts    # the tabs tool and the permission broker
      src/popup/, src/permission/   # the toolbar popup and the permission windows (incl. mic.html)
      src/voice/, src/offscreen/    # ask by voice: the session, the mic page hold, the offscreen mic page
      src/content/page-reader.ts    # injected on demand: selection, URL, title, page text
```

| Package          | Responsibility                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protocol/ts`    | `@tagalong/contract`: zod schemas for contract v1. Depends only on zod.                                                                                                                          |
| `bodies/ui`      | React components shared by hosts: `DockPet`, `CompanionBubble` and its cards, Home's `HomeView`, and the `HostBridge` context. `@tagalong/ui/shapes` is the React-free part.                     |
| `bodies/desktop` | Electron host. Dials the Python brain over the loopback socket, and owns Scout's window, the bubble, Home, the tray, hotkeys, secret storage, and Scout's voice and ears.                        |
| `bodies/browser` | Browser body (Chromium MV3). Dials the Python brain through `@tagalong/contract` and offers the `tabs` tool, with a permission window and a toolbar popup. It can listen by voice (listen only). |

## How to run

Prerequisites:

- Windows 11 (the only supported platform; `createPlatform` throws on any other platform)
- Node.js 22 or newer (`node -v`)
- pnpm 10 — the root `packageManager` field pins the exact version. Two ways to get it:
  - `corepack enable` — only works from an **elevated** shell. From a normal shell on Windows it fails
    with `Internal Error: EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm.ps1'`
    (the filename varies: `yarnpkg`, `pnpm.cmd`, and so on). If you see that, use the next line.
  - `npm install -g pnpm@10` — installs into the user-level npm prefix and needs no elevation.
- Git

No C++ toolchain is needed. `get-windows` and the other native modules ship prebuilt binaries, and their
install scripts are listed under `pnpm.ignoredBuiltDependencies`, so nothing compiles on install.

Commands, run from the repository root:

```bash
pnpm install         # install all workspace dependencies
pnpm lint            # ESLint across every package
pnpm format:check    # Prettier check (pnpm format rewrites)
pnpm typecheck       # TypeScript project references, no emit, plus the test project
pnpm test            # Vitest across every package and app
pnpm test:coverage   # Vitest with v8 coverage and per-package floors (see Coverage below); CI runs this
pnpm build           # build every package (tsc -b, and electron-vite for the desktop app)
pnpm dev:desktop     # run the Electron host in development
pnpm package:win     # build everything, then the Windows NSIS installer (run on Windows)
pnpm package:mac     # dmg — configured, not verified
pnpm package:linux   # AppImage and deb — configured, not verified
```

Inside `bodies/desktop`:

```bash
pnpm build            # ensure-electron, then electron-vite build into dist/
pnpm start            # ensure-electron, then electron-vite preview against the built output
pnpm start:fresh      # the same, on a new temp data folder, so you start from a clean profile
pnpm --filter @tagalong/desktop test:e2e  # ensure-electron, electron-vite build, then the Playwright smoke suite
pnpm ensure-electron  # fetch the Electron binary on its own
pnpm package:win      # fetch-native, electron-vite build, electron-builder --win nsis
pnpm package:dir      # an unpacked app in release/, for checking what gets packaged
```

### The Python brain

Needs [uv](https://docs.astral.sh/uv/) and Python 3.12 or 3.13 (the voice libraries do not
support 3.14 yet; uv fetches a matching Python itself). From `brain/`:

```bash
uv sync                    # install dependencies into brain/.venv
uv run pytest              # tests, including the shared protocol/examples
uv run ruff check          # lint
uv run ruff format --check # format check
uv run brain               # starts the websocket server (see docs/brain.md)
```

The `brain` job in CI runs these commands, installing with `uv sync --locked`.

### Coverage

`pnpm test:coverage` runs every package's tests once, from the root, and checks a floor per area.
CI runs it in place of `pnpm test`, so a drop below any floor fails the build. The floors live in
the root `vitest.config.ts`.

| Area                                                       | Floor (statements / branches / functions / lines) |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `protocol/ts/src`                                          | 70 / 70 / 70 / 70                                 |
| `bodies/ui/src`                                            | 91 / 83 / 90 / 93                                 |
| `bodies/desktop/src/main` and `bodies/desktop/src/preload` | 59 / 62 / 49 / 60                                 |

The `bodies/ui` and desktop host floors sit just below what they measure.
Raise them when coverage grows; never lower them to make a change pass. The desktop renderer and
the browser body are not measured: the Playwright suites cover them.

### Packaging

`bodies/desktop/electron-builder.json` drives every installer; the output lands in
`bodies/desktop/release/`.

- **Windows (the one that matters).** A per-user NSIS installer for x64: no admin rights, a choice of
  folder, Start menu and desktop shortcuts, and Tagalong starts when it finishes. Build it on Windows
  with `pnpm package:win` from the root. It is unsigned; signing needs a certificate and the
  `CSC_LINK` / `CSC_KEY_PASSWORD` variables electron-builder reads, which a personal build can skip.
- **Native modules are not rebuilt.** nut-js's `libnut` and the other native modules ship N-API binaries,
  which load in Electron unchanged, so
  `npmRebuild` is off and no C++ toolchain is ever needed. Every `.node` file is unpacked out of
  `app.asar`, where Node cannot load it. `get-windows`' Windows binary is downloaded by
  `scripts/fetch-native.mjs`, because pnpm skips the install script that normally fetches it.
- **Only runtime modules are packaged.** The workspace packages are bundled into `dist/` by
  electron-vite, so they are `devDependencies`; the desktop's `dependencies` are exactly what the
  packaged app loads at runtime (the native modules and the voice libraries), which electron-builder
  copies. The full list is under "Bundling the workspace packages" in
  [desktop.md](desktop.md#bundling-the-workspace-packages).
- **The browser body ships inside.** `bodies/browser/dist` is copied to `resources/extension`, so
  someone with only the installer can still load it unpacked. `pnpm package:win` from the root builds
  it first.
- **macOS dmg and Linux AppImage/deb are configured but unverified**, and would not run anyway: there
  is no macOS or Linux platform adapter.
- CI does not build the installer.

### CI

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. Four
jobs:

- **`changes`** (Linux, seconds). Asks `dorny/paths-filter` whether anything outside `docs/` that is
  not Markdown changed. When nothing counts, the other three jobs are skipped. If `changes` itself
  fails, `build` runs anyway rather than skipping.
- **`build`** (Linux). Install, lint, format check, typecheck (`tsc -b` and the test project), and
  the unit tests with coverage and the floors above.
- **`brain`** (Linux). The Python brain: `uv sync --locked`, `uv run ruff check`,
  `uv run ruff format --check` and `uv run pytest`, run from `brain/`. Gated like `build`.
- **`e2e`** (Windows). Starts only after `build` passes. Runs `pnpm build` first, because the tests
  import the workspace packages from their compiled `dist` (on Linux the typecheck's `tsc -b` does
  this). Then the unit tests that skip themselves off Windows (`*.integration.test.ts` against a
  real PowerShell), and the Electron end-to-end suites.

Branch protection on `main` requires `build`, `e2e` and `brain`. A docs-only pull request skips all three, and a
skipped required check counts as passed, so it can merge. A `paths-ignore` trigger would not work
here: the workflow would never start, the required checks would never report, and the pull request
would wait forever. Docs-only changes also skip the format check, so run `pnpm format:check` locally
before pushing Markdown.

A newer push to a pull request cancels the run still going for the older one. Every push to `main`
runs in its own concurrency group, so none is cancelled or dropped from the queue.

A unit test that only works on Windows uses `it.runIf(process.platform === 'win32')` (or
`describe.skipIf`), and its file joins the "Windows-only unit tests" step in `ci.yml`, so it still
runs somewhere.

### End-to-end tests and fakes

The `e2e` CI job runs the Electron end-to-end suites. `bodies/desktop/e2e/` holds the Playwright suites
that launch the built app: `smoke.spec.ts` (the bubble, talking, a tool call, pause, hotkeys, Home),
`hotkey-recovery.spec.ts`
(a key another app owns), `listening.spec.ts` (Always listening: off at launch, switched on, a turn
that starts with "Scout" is heard and answered, switched off), `brain-offline.spec.ts`,
`asks.spec.ts` (the permission ask in the bubble), `approvals.spec.ts` (Home's Approvals page and
the `approved` report card), `jobs.spec.ts` (Claude Code jobs and their cards), `permissions.spec.ts`
(Home's Permissions list) and `where-things-run.spec.ts` (Overview's "Where things run" card). Run
them with `pnpm --filter @tagalong/desktop test:e2e`.

The suites run offline on fakes. The desktop answers turns only through a brain, so `smoke.spec.ts` and
`listening.spec.ts` start `e2e/fixtures/fake-brain.ts`, a `ws` server that speaks contract v1 (it answers
`hello`, then every `say` with one scripted reply; it also answers Home's permission and jobs tools and, for a
say that mentions "permission" or "hand off", opens the asks `asks.spec.ts` and `jobs.spec.ts` need), and pass
its address as `TAGALONG_BRAIN_ADDR`.
`brain-offline.spec.ts` points the app at a port nothing listens on and expects the offline mark. The fake microphone: `TAGALONG_FAKE_MIC=1`.
A quit that does not finish in 45 s is
killed by `e2e/fixtures/close-app.ts`, which then waits for the process to exit, so a hung teardown
cannot hold the single-instance lock or the data folder. When an e2e suite
fails in CI, its `test-results` folder (page snapshots and screenshots) is uploaded as the
`e2e-test-results` artifact.

Quit any running Tagalong before `pnpm --filter @tagalong/desktop test:e2e`. The main process takes a single-instance lock, so a
second copy quits immediately and Playwright reports the confusing
`electron.launch: Target page, context or browser has been closed` instead of naming the real cause.

The smoke suite saves screenshots of Home to `bodies/desktop/test-results/` (gitignored) for design
review: `home.png` and `connections.png`.

## Running the desktop app

One command is enough: the desktop starts the brain if none is running (see Commands in CLAUDE.md):

```powershell
cd brain; uv sync; cd ..
pnpm install
pnpm dev:desktop
```

The desktop dials the brain at `TAGALONG_BRAIN_ADDR` (default `127.0.0.1:47321`) and retries every 2 s. It spawns `uv run brain` (cwd `brain/`) only when the address is local and
nothing answers there, and on quit stops only the brain it started; a brain you started yourself
(`cd brain && uv run brain`) is used as is and left running. Set `TAGALONG_START_BRAIN=0` to stop
the desktop starting one.

To see what a new user sees, run `pnpm --filter @tagalong/desktop
start:fresh`: it starts on a new folder in the temp directory (`--user-data-dir`), so your own `%APPDATA%\Tagalong` is never touched. Quit any
running Tagalong first; the fresh copy has no saved keys. The tray's **Open Tagalong** item opens Home. Two more things are worth knowing before the first run.

**`ensure-electron`.** Electron 44.3.0 publishes no npm install script, so `pnpm install` unpacks the
package without ever downloading the platform binary, and the first launch dies with an error that
reads like a broken machine. `bodies/desktop/scripts/ensure-electron.mjs` runs the Electron package's own
`install.js` when `dist/` is missing, and it is wired into the `dev`, `build`, and `start` scripts — so
you normally never call it yourself.

### Choosing Scout's brain

The Python brain picks Scout's model and holds its keys (see [brain.md](brain.md)). You enter your Anthropic key in the app: the first-run walkthrough asks for it, and **Settings → Anthropic key** changes it and the daily limit. A real `ANTHROPIC_API_KEY` in the environment still works and wins (the developer path). The desktop has no provider or model picker and no sign-in check.

Once running: Scout sits on screen as a small always-on-top window, `Ctrl+Shift+Space` captures the
selection and the active window and opens the bubble beside it, Escape or focus loss hides the
bubble (unless a turn is still streaming), and the tray menu opens Home (**Open Tagalong**), pauses
sight, shows or hides Scout, and quits.

| Hotkey                     | What rides along                                   | Roughly what it costs |
| -------------------------- | -------------------------------------------------- | --------------------- |
| `Ctrl+Shift+Space`         | Selection and the active window                    | text only             |
| `Ctrl+Shift+Alt+P`         | Nothing — turns all sight off, and on again        | nothing               |
| `Ctrl+Shift+Alt+M`         | Nothing — Scout stops speaking                     | nothing               |
| `Right Ctrl` (hold, alone) | The active window, and the spoken question as text | text only             |

The ask key exists for the one thing only a key can do: read the selection and the window you are on
before the bubble takes the focus. A click on Scout captures nothing, because it has just put
Scout's own window in front. Screenshots (about 1,500 extra input tokens), the window list (a few
seconds to enumerate) and other monitors are Scout's own tools, taken only when a question needs
them. The pause key takes sight away entirely — see [Pausing sight](privacy.md#pausing-sight).

Every accelerator is editable in Home → Settings → Shortcuts and rebinds while the app runs — no
restart — and an accelerator another application already owns is reported rather than silently
dropped, without costing the other.

**A hotkey that cannot be registered never stops Tagalong from starting.** The only way to store an
accelerator Windows refuses is to type it into Settings, so an app that refused to open because of
one would leave you locked out of the window that fixes it, with the settings file as the only way
back. Instead the app starts, the other keys work, and the failure appears in the bubble and in
Settings naming which binding broke and what it was bound to. Correcting it takes effect
immediately, with no restart.

### Scout

A fresh install starts with one companion, **Scout**, which lives in the Python brain. Memories and
conversations are the brain's, saved in its own store (see [memory.md](memory.md) and
[brain.md](brain.md)).

### Capture

Capture is never silent. Every capture, including one Scout's own tool asked for, shows on Scout
and updates the tray tooltip to say what was read and when. Before any screenshot the host checks the
focused window against the capture exclusions in settings (password managers and the Windows
credential prompts by default); when one matches, no picture is taken at all and the bubble is told
that capture is blocked here, naming only the exclusion entry that matched.

### No pairing token

The Python brain has no pairing token: it is single user and listens on `127.0.0.1`, and a body's
`hello` carries only the protocol version, its kind and its tools (see
`hello` carries only the protocol version, its kind and its tools (see
[protocol/README.md](../protocol/README.md)). The desktop shows no pairing step.

The data directory is `%APPDATA%\Tagalong` on Windows, which is `productName` in
`bodies/desktop/package.json`: Electron derives it from there, and changing it moves everyone's
settings and saved keys with no migration.

## The browser body in detail

The browser body is a second body for the Python brain: it offers Scout the `tabs`, `page_parts`,
`browser_search` and `tab_actions` tools, and you can ask Scout from a right-click on selected text or
the address bar. It has no chat and no side panel; Scout talks in the desktop bubble. Everything is in
[browser-body.md](browser-body.md).

**It needs the brain running.** The body dials the brain on `127.0.0.1:47321` (change it in the
popup) and retries by itself, so start a brain first (`pnpm dev:desktop` does, or `cd brain && uv run brain`).

### Build and load it

```bash
pnpm install
pnpm --filter @tagalong/browser build   # writes bodies/browser/dist
```

1. In the desktop app, open **Home → Settings → Add Scout to your browser**. It shows the folder to
   load and has **Show folder** and **Copy chrome://extensions** buttons.
2. Open `chrome://extensions` (or `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose that folder (`bodies/browser/dist` from source,
   `resources/extension` in the installed app).
4. Pin Tagalong in the puzzle-piece menu so the toolbar button is visible.

After a rebuild, click the reload arrow on the Tagalong card in `chrome://extensions`. Load it in
Chrome and Edge at once if you like: each gets its own body id.

### Use it

Nothing to pair. Ask Scout about your tabs ("what tabs do I have open?", "read this page"). The
first time a tool needs something, a small window asks you to allow it. The toolbar popup shows the
link to the brain, the brain's address, a name for this browser and what you have allowed.

### Publish it

The Chrome Web Store listing text, permission justifications, data disclosures, image list and
submission steps are in [docs/chrome-web-store/listing.md](chrome-web-store/listing.md). The
public privacy policy is [docs/chrome-web-store/privacy-policy.md](chrome-web-store/privacy-policy.md).

## Environment variables

`.env.example` is a **reference list of the variables the project uses**, not a file the app loads.
Nothing reads `.env.local`: there is no dotenv dependency, and no code in `protocol/` or `bodies/`
opens a `.env` file. Copying it therefore changes nothing at runtime.

The desktop reads the variables below straight from the process environment. **Set them in the
shell you launch from**, as shown above. The brain's variables (its key, model, budget and limits) are
listed in `.env.example` and described in [brain.md](brain.md).

| Variable                | Status                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAGALONG_BRAIN_ADDR`   | **Read** (`brain/start.ts`). Host:port the desktop dials for the brain; default `127.0.0.1:47321`. The brain reads the same name for where it listens.                                                                                   |
| `TAGALONG_START_BRAIN`  | **Read** (`brain/launch.ts`). `0` stops the desktop starting a local brain when none is running; the Electron specs that need the brain down set it.                                                                                     |
| `ELECTRON_RENDERER_URL` | **Read** (`windows/page.ts`). The dev server's address, set by `electron-vite` under `pnpm dev:desktop`; the packaged app loads its files instead.                                                                                       |
| `TAGALONG_FAKE_MIC=1`   | **Read** (`main/index.ts`). Chromium's fake microphone stands in for a real one (`use-fake-device-for-media-stream`). The brain does the hearing, so the specs' fake brain scripts what it heard. The smoke and listening suites set it. |

## Conventions

- **Test first.** Write the failing test, make it pass, refactor. No production code without a test that
  motivated it.
- **Never overengineer.** Build what the current task needs. Interfaces exist only where a second
  implementation is already planned.
- **Protocol stays pure.** `protocol/ts` depends on zod only and must not import `electron`, `react`, or
  browser globals. An ESLint `no-restricted-imports` rule enforces it. `@tagalong/ui/shapes` must stay
  React-free (ESLint block plus `bodies/ui/src/source-guard.test.ts`).
- **Docs are part of done.** Update `README.md`, the subsystem doc in `docs/` that describes the
  code you changed (the [index](README.md) lists them), and `docs/testing/feature-test-guide.md`
  with every change.
- **Comments.** Every file opens with a 2-6 line header: what it is for, what it contains, who uses
  it. Comments explain why, limits, units and parse-compat rules; phase numbers, PR references and
  history belong in git. Test files get a one-line header.
- **Commits** use Conventional Commits, for example `feat(desktop): add the capture notice`.
- **Diagrams** are Mermaid only, and every block starts with the monochrome init line the docs
  share (copy it from any doc in `docs/`): grey lines and titles, so diagrams read on GitHub's light
  and dark themes.

## Known gaps

Gaps that are real in the code on `main`, each explained in the doc it links to.

- **No Fast Refresh in dev.** The renderer uses Vite's esbuild JSX transform, not
  `@vitejs/plugin-react`. See [desktop.md](desktop.md#bundling-the-workspace-packages).
- **Windows only, unsigned installer.** There is no macOS or Linux platform adapter, so the app
  stops at launch there; the Windows installer is unsigned. See
  [desktop.md](desktop.md#the-platform-adapter) and [desktop.md](desktop.md#packaging).
- **Real voice models are not run in CI.** The Python tests use fake adapters and the Electron
  suites run on a fake brain, so synthesis and transcription run only on a real machine. See [voice.md](voice.md#tests-that-pin-it).
