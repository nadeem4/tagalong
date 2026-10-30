# Developer guide

How to build, run, test and package Tagalong from source, and the conventions the code follows. For how it works inside, start at [architecture.md](architecture.md); the [docs index](README.md) lists every subsystem doc.

## Repository layout

A pnpm workspace monorepo. One core engine, many thin hosts.

```text
tagalong/
  package.json                      # pnpm workspace root (private)
  pnpm-workspace.yaml
  tsconfig.base.json                # plus tsconfig.json and tsconfig.tests.json
  vitest.config.ts                  # projects: packages/*, bodies/*; coverage thresholds
  eslint.config.js
  .github/workflows/ci.yml          # changes, build (Linux), e2e (Windows)
  docs/
    README.md                       # the index and reading order
    architecture.md, protocol.md    # the whole system; the wire protocol
    desktop.md, bubble.md, voice.md, browser-body.md   # the hosts
    sight.md, mind.md, memory.md, experts.md, asks.md, routines.md,
    connected-apps.md               # the engine's subsystems
    settings-and-secrets.md, storage.md, privacy.md, development.md
    testing/feature-test-guide.md   # manual tests
    chrome-web-store/               # store listing kit and the extension's privacy policy
  protocol/                         # contract v1 for the Python brain (README.md is the spec)
    examples/                       # sample frames shared by the TypeScript and Python tests
    ts/                             # @tagalong/contract: zod schemas for contract v1
  brain/                            # the Python brain: uv project, tests/; src/brain/ has protocol.py,
                                    # config.py, bodies.py, server.py, apps.py, app_tools.py and
                                    # main.py (see docs/brain.md)
  packages/
    protocol/src/
      index.ts                      # PROTOCOL_VERSION, ENGINE_HOST, DEFAULT_ENGINE_PORT, engineUrl
      context.ts                    # ContextSnapshot, CapturedImage, DisplaySnapshot, WindowEntry,
                                    # ContextSnapshotPatch, PerceptionTarget
      pet.ts                        # Pet, SCOUT_ID
      message.ts                    # Conversation, Message, MessageContent
      rpc.ts                        # JSON-RPC envelopes and error codes
      settings.ts                   # Settings, SettingsPatch, SETTINGS_DEFAULTS
      methods.ts                    # the method and notification catalog
      roles.ts                      # Role, ModelTier
                                    # plus activity, addressing, asks, awareness, blind-spots,
                                    # connections, experience, experts, limits, memory, pick-up,
                                    # routines, self, sight-log, status, usage and voice schemas
    core/roles/                     # companion.md, the one role: YAML header plus mechanics
    core/constitution.md            # values, their order, the Never list
    core/soul/                      # scout.md, Scout's soul: Character
    core/scripts/gen-roles.mjs      # compiles roles/*.md, soul/*.md and constitution.md into src/roles/library.generated.ts
    core/src/
      index.ts                      # the public facade hosts import
      engine.ts                     # Engine.boot: wires the parts together and listens
      conversation/                 # ConversationRunner, prompt-assembler, now.ts (the Now block)
      perception/                   # exclusions, retention, inventory, text layer, browser routing
      tools/                        # tool.ts (the Tool shape), registry.ts, builtin/ (the built-ins and connected-app tools)
      connections/                  # MCP client: manager, OAuth + loopback, approvals, catalog, Claude Code reader, fake server
      memory/                       # db.ts (numbered migrations), store.ts (ConversationStore), recall.ts, digest.ts,
                                    # activity, experience log, sight log, history search, summarizer
      asks/                         # saved asks (Waiting on you)
      experts/                      # hand-offs, the catalog, the Claude Code connector, the fake connector
      routines/                     # the scheduler, schedules and triggers, the routine store
      jobs/                         # Scout's own background jobs (Jobs, JobStore), the task board
      meetings/                     # Meeting prep's calendar feed: the .ics link, parsed with ical.js
      check-in/                     # the check-in moment: gate, facts, the one call, reply parsing; Arrivals
      keep-an-eye/                  # the lookout over window titles
      pick-up/                      # pick up where you left off
      self/                         # the Self (notes, proposals) and sleep
      usage/                        # the meter, prices and the daily budget
      watch/, projects/, privacy/   # watches, the project finder, the blind spots
      pets/registry.ts              # PetRegistry, the default pet Scout
      roles/                        # library.generated.ts, getRole, roleFor, recommendedModel, tiers.ts
      providers/                    # brain.ts, claude-code-brain.ts, anthropic.ts, openai-compatible.ts,
                                    # presets.ts, watch-models.ts, guard.ts, key-resolver.ts, fake.ts,
                                    # registry.ts, errors.ts
      server/                       # ws-server.ts (EngineServer), pairing.ts
      settings/settings.ts          # SettingsStore, SecretStore, InMemorySecretStore
  bodies/
    ui/src/
      index.ts, host-bridge.ts      # HostBridge contract and its React context
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
                                    # hotkeys.ts, talk-key.ts, always-listening.ts, secret-store.ts,
                                    # tray-icon.ts, tray-menu.ts,
                                    # claude-sign-in.ts, sight-pause.ts, drop.ts,
                                    # log-file.ts, awareness/, ipc/,
                                    # platform/, voice/, windows/
      src/main/voice/               # voice.ts (the mouths), kokoro.ts, elevenlabs.ts, ears/ (models, LocalEars)
      src/main/voice/worker/        # the voice process: client.ts (VoiceWorker), messages.ts,
                                    # handler.ts, ears-host.ts, worker-local-voice.ts, main.ts (its bootstrap)
      src/main/platform/            # capture, downscale, composite, canvas, label, displays, ocr,
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
    browser/                        # browser body (Chromium MV3), built by Vite into dist/ (load unpacked)
      src/manifest.ts               # the manifest as data; the build writes dist/manifest.json
      src/body.ts, identity.ts      # the body: one BrainClient, tools, body id <browser>-<4 chars>
      src/tools/, permissions.ts    # the tabs tool and the permission broker
      src/popup/, src/permission/   # the toolbar popup and the permission window
      src/content/page-reader.ts    # injected on demand: selection, URL, title, page text
```

| Package             | Responsibility                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Zod schemas for context snapshots, pets, messages, settings, and JSON-RPC, plus the method catalog. Depends only on zod.                                                                                    |
| `packages/core`     | The Tagalong Engine: Scout, conversation runner, prompt assembly, SQLite memory, experts and hand-offs, connected apps (MCP client), routines, host protocol server, pairing, provider adapters. Pure Node. |
| `bodies/ui`         | React components shared by hosts: `DockPet`, `CompanionBubble` and its cards, Home's `HomeView`, and the `HostBridge` context.                                                                              |
| `bodies/desktop`    | Electron host. Dials the Python brain over the loopback socket, and owns Scout's window, the bubble, Home, the tray, hotkeys, secret storage, and Scout's voice and ears.                                   |
| `bodies/browser`    | Browser body (Chromium MV3). Dials the Python brain through `@tagalong/contract` and offers the `tabs` tool, with a permission window and a toolbar popup.                                                  |

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

No C++ toolchain is needed. `better-sqlite3` and `get-windows` ship prebuilt binaries, and their
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

Needs [uv](https://docs.astral.sh/uv/) and Python 3.12 or newer. From `brain/`:

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
| `packages/core/src`                                        | 70 / 70 / 70 / 70                                 |
| `packages/protocol/src`                                    | 70 / 70 / 70 / 70                                 |
| `bodies/ui/src`                                            | 91 / 83 / 90 / 93                                 |
| `bodies/desktop/src/main` and `bodies/desktop/src/preload` | 59 / 62 / 49 / 60                                 |

The `bodies/ui` and desktop host floors sit just below what they measured when they were added.
Raise them when coverage grows; never lower them to make a change pass. The desktop renderer and
the browser body are not measured: the Playwright suites cover them.

Inside `packages/core`:

```bash
pnpm gen:roles        # compile roles/*.md, soul/*.md and constitution.md into src/roles/library.generated.ts (commit the result)
```

Run `pnpm --filter @tagalong/core gen:roles` from the root (or `node scripts/gen-roles.mjs` from
`packages/core`, which also works in a git worktree) after editing any file in
`packages/core/roles/` or `packages/core/soul/`, or `packages/core/constitution.md`. It needs `packages/protocol` built first, because it validates each role
against the protocol's `Role` schema. A test fails while the generated file is stale.

### Packaging

`bodies/desktop/electron-builder.json` drives every installer; the output lands in
`bodies/desktop/release/`.

- **Windows (the one that matters).** A per-user NSIS installer for x64: no admin rights, a choice of
  folder, Start menu and desktop shortcuts, and Tagalong starts when it finishes. Build it on Windows
  with `pnpm package:win` from the root. It is unsigned; signing needs a certificate and the
  `CSC_LINK` / `CSC_KEY_PASSWORD` variables electron-builder reads, which a personal build can skip.
- **Native modules are not rebuilt.** `better-sqlite3` 13 and nut-js's `libnut` ship N-API binaries,
  which load in Electron unchanged (checked: the packaged app opens SQLite 3.53.4 on Electron 44), so
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

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. Three
jobs:

- **`changes`** (Linux, seconds). Asks `dorny/paths-filter` whether anything outside `docs/` that is
  not Markdown changed. The role files in `packages/core/roles/*.md` count as code, because they
  compile into core. When nothing counts, the other two jobs are skipped. If `changes` itself
  fails, `build` runs anyway rather than skipping.
- **`build`** (Linux). Install, lint, format check, typecheck (`tsc -b` and the test project), and
  the unit tests with coverage and the floors above.
- **`e2e`** (Windows). Starts only after `build` passes. Runs `pnpm build` first, because the tests
  import the workspace packages from their compiled `dist` (on Linux the typecheck's `tsc -b` does
  this). Then the unit tests that skip themselves off Windows (`*.integration.test.ts` against a
  real PowerShell, and the npm `.cmd` shim cases in `claude-sign-in.test.ts` and
  `claude-code.test.ts`), and the Electron end-to-end suites.

Branch protection on `main` requires `build` and `e2e`. A docs-only pull request skips both, and a
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
that launch the built app: `smoke.spec.ts` (the bubble, talking, capture, pause, hotkeys, Home),
`hotkey-recovery.spec.ts`
(a key another app owns), `listening.spec.ts` (Always listening: off at launch, switched on, a turn
that starts with "Scout" is heard and answered, switched off), plus `brain-offline.spec.ts`. Run them with `pnpm --filter @tagalong/desktop
test:e2e`.

The suites run offline on fakes. The desktop answers turns only through a brain, so `smoke.spec.ts` and
`listening.spec.ts` start `e2e/fixtures/fake-brain.ts`, a `ws` server that speaks contract v1 (it answers
`hello`, then every `say` with one scripted reply; it also answers Home's permission and jobs tools and, for a
say that mentions "permission" or "hand off", opens the asks `asks.spec.ts` and `jobs.spec.ts` need), and pass
its address as `TAGALONG_BRAIN_ADDR`.
`brain-offline.spec.ts` points the app at a port nothing listens on and expects the offline mark. Other fakes:
`TAGALONG_FAKE_TTS=1`, `TAGALONG_FAKE_STT=1`. Specs for features the new brain has not rebuilt yet are
`test.skip` with a reason of the form `returns with row N: <feature>` (the Launch board row that brings
the feature back): the tool-call round trip.
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

Start the brain, then the desktop (see Commands in CLAUDE.md):

```powershell
cd brain; uv run brain   # leave it running
pnpm install
pnpm dev:desktop
```

The desktop dials the brain at `TAGALONG_BRAIN_ADDR` (default `127.0.0.1:47321`) and retries every 2 s, so the order does not matter.

To see what a new user sees, run `pnpm --filter @tagalong/desktop
start:fresh`: it starts on a new folder in the temp directory (`--user-data-dir`), so your own `%APPDATA%\Tagalong` is never touched. Quit any
running Tagalong first; the fresh copy has no saved keys. The tray's **Open Tagalong** item opens Home. Two more things are worth knowing before the first run.

**`ensure-electron`.** Electron 44.3.0 publishes no npm install script, so `pnpm install` unpacks the
package without ever downloading the platform binary, and the first launch dies with an error that
reads like a broken machine. `bodies/desktop/scripts/ensure-electron.mjs` runs the Electron package's own
`install.js` when `dist/` is missing, and it is wired into the `dev`, `build`, and `start` scripts — so
you normally never call it yourself.

### Choosing Scout's brain

The Python brain picks Scout's model and holds its keys, in the brain's `.env` (see [brain.md](brain.md)). The desktop has no provider or model picker and no API key rows. Settings' **How Scout thinks** card shows whether the Claude Code sign-in works (`claude auth status --json`, run locally with no model call).

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
**With several monitors, a look sends** (Settings → Advanced → Sight detail) decides whether a capture of every
display attaches only the composite and the focused display, or every display.

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

A fresh install starts with one companion, **Scout**, on the Claude Code sign-in. Scout hands work
to experts (see [experts.md](experts.md)).

Scout remembers. Tell it "I prefer short answers" and it keeps that across restarts; it can also
save facts on its own. Memories live in the same
SQLite file as conversations (`tagalong.db` in the data dir).

### Awareness: rolling memory and watches

Rolling memory's switch is in Settings → **Privacy** (**Remember the last few minutes of the
screen**); its minutes and the watch limits are under **Advanced → Screen memory and watches**. Both
take effect on save.

- **Rolling memory** (off by default). Turn it on and the desktop keeps the last few minutes — ten by
  default, at most thirty — of every screen in memory, never on disk. A small red dot on Scout shows
  while it records.
- **The engine's time tools.** `recall_screen`, `what_changed` and `watch_for` (a watch compares the
  screen every five seconds and asks one small model yes or no only once the region has changed and
  held still) are on the Companion role, with `look_closer`, `list_displays` and
  `look_at_display`. A routine's own turn never gets `watch_for`, so a watch routine cannot set off
  itself. The watch limits below bound every watch.

| Watch limit (Settings)         | Default | What it bounds                                    |
| ------------------------------ | ------- | ------------------------------------------------- |
| Checks per watch               | 60      | Model calls one watch may make before it gives up |
| Watches at once                | 3       | A fourth is refused                               |
| Watch gives up after (minutes) | 30      | How long a watch runs before it ends on its own   |

A watch's check model is `Pet.watchModel`, else the provider's default (`watchModelsFor` in
`packages/core/src/providers/watch-models.ts`); Home has no field for it.

### The two cost controls

Both live in Settings under **Advanced → Sight detail** and both take effect on save, with no restart: they are read at the
moment of each capture rather than at boot.

| Setting                               | Default                            | What raising it costs                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What a look at every screen sends** | Composite plus the focused display | `Every screen` sends one picture per monitor, so a three-monitor desk pays roughly three times the image cost on every look at every screen                                           |
| **Window text budget**                | 8,000 characters                   | How much of a window a read returns when Scout does not ask for less. Roughly one token per four characters, so the default is about 2,000 tokens per read, and the ceiling is 40,000 |

The budget is a ceiling, not a target — Scout asks for less when it only needs the top of a
terminal, and the number it does not ask for is the one set here.

Capture is never silent. Every capture, including one Scout's own tool asked for, shows on Scout
and updates the tray tooltip to say what was read and when. Before any screenshot the host checks the
focused window against the capture exclusions in settings (password managers and the Windows
credential prompts by default); when one matches, no picture is taken at all and the bubble is told
that capture is blocked here, naming only the exclusion entry that matched.

### No pairing token

The Python brain has no pairing token: it is single user and listens on `127.0.0.1`, and a body's
`hello` carries only the protocol version, its kind and its tools (see
[protocol/README.md](../protocol/README.md)). The desktop shows no pairing step. The old engine's
token (`readOrCreatePairingToken`, `packages/core`) goes when `packages/core` is deleted.

The data directory is still `%APPDATA%\Tagalong` on Windows, which is `productName` in
`bodies/desktop/package.json`: Electron derives it from there, and changing it moves everyone's
settings and saved keys with no migration.

## The browser body in detail

The browser body is a second body for the Python brain: it offers Scout the `tabs`, `page_parts`,
`browser_search` and `tab_actions` tools, and you can ask Scout from a right-click on selected text or
the address bar. It has no chat and no side panel; Scout talks in the desktop bubble. Everything is in
[browser-body.md](browser-body.md).

**It needs the brain running.** The body dials the brain on `127.0.0.1:47321` (change it in the
popup) and retries by itself, so start `cd brain && uv run brain` first.

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
Nothing reads `.env.local`: there is no dotenv dependency, and no code in `packages/` or `bodies/`
opens a `.env` file. Copying it therefore changes nothing at runtime.

Three environment variables are read by the desktop, all straight from the process environment. **Set them in the
shell you launch from**, as shown above.

| Variable                | Status                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAGALONG_FAKE_SIGN_IN` | **Read** (`bodies/desktop/src/main/claude-sign-in.ts#fakeSignIn`), in any build. One of `signed-in`, `signed-out`, `not-installed` or `unknown` stands in for the Claude Code sign-in check, so no claude binary runs. The Electron suites set `signed-in`.                                                                                                                                                |
| `TAGALONG_FAKE_TTS=1`   | **Read** (`voice/voice.ts`). Scout's voice becomes a short silent clip: no model download, no ElevenLabs call, no sound. Every Electron suite sets it.                                                                                                                                                                                                                                                     |
| `TAGALONG_FAKE_STT=1`   | **Read** (`voice/worker/main.ts`, `main/index.ts`). The voice process uses the fake ears: a held question is heard as "What am I looking at?" every time, and in always mode (`FAKE_TURN_FRAMES` frames of the fake microphone end one turn) as "Scout, what am I looking at?", with no speech model download; Chromium's fake microphone stands in for a real one. The smoke and listening suites set it. |
| `ANTHROPIC_API_KEY`     | **Not read.** The key for the `anthropic` BrainProvider is entered in Settings and stored via Electron `safeStorage`, never taken from the environment.                                                                                                                                                                                                                                                    |
| `OPENROUTER_API_KEY`    | **Not read.** The key for the `openrouter` provider, entered in Settings and stored like the Anthropic key.                                                                                                                                                                                                                                                                                                |
| `ELEVENLABS_API_KEY`    | **Not read.** The optional ElevenLabs voice's key is entered in Settings → Advanced and stored like the others (`elevenlabs.apiKey`).                                                                                                                                                                                                                                                                      |

Secrets never enter git. In the app they live in the OS keychain through Electron `safeStorage`, written
as ciphertext to `secrets.json`; if the OS has no encryption backend the store refuses to write at all
rather than leaving a key readable on disk.

## How to add a host

A host is anything that can show Scout and capture what the user is looking at: the Electron app, the
the browser body, or something new. Adding one never touches the core.

1. Implement the **Perception** contract: answer `perception.capture` for selection, active window,
   clipboard, page text and screenshot, returning a `ContextSnapshotPatch` from
   `packages/protocol`. Advertise only what you can actually read, in the `capabilities` array of
   `hello`.
2. Implement the **Presentation** contract: render Scout, stream reply deltas, and show the cards.
   The shared React components in `bodies/ui` do this already — hand them a `HostBridge` and nothing
   else.
3. Speak the JSON-RPC protocol over the localhost WebSocket the engine exposes
   (`ws://127.0.0.1:47321` by default), sending `hello` first. The method catalog and
   every payload schema live in `packages/protocol`.
4. Never import core internals. A host uses the protocol, and the engine's public API only where it
   embeds the engine in process. `bodies/browser` imports nothing from core at all.

## How to add a provider

Providers are the swappable edges of the engine. Each one is an interface in `packages/core` with more
than one planned implementation.

- **BrainProvider** for the AI engine. Existing: `claude-code` (the Claude sign-in, through the
  `claude` CLI), `openrouter` (a preset of the OpenAI-compatible `OpenAiCompatibleProvider`),
  `anthropic`, and `fake` (tests and demos). Another OpenAI-format
  service needs no code — see [Choosing Scout's brain](#choosing-scouts-brain) (old brain only); a new named preset
  is one entry in `packages/core/src/providers/presets.ts`.
- **Text to speech** lives in the desktop host, not in core: `Tts` in
  `bodies/desktop/src/main/voice/voice.ts` (`speak(text, { voice, speed })` returns encoded audio),
  with Kokoro (`LazyLocalVoice` over `kokoro.ts`), ElevenLabs (`elevenlabs.ts`) and `fakeTts`.
  `createVoiceService` picks one; see [The mouth](voice.md#the-mouth).
- **Speech to text** also lives in the desktop host: the `Ears` in the voice process, `LocalEars`
  (Silero VAD, Moonshine tiny and Smart Turn, `voice/ears/`) on this computer, or `FakeEars` under
  `TAGALONG_FAKE_STT=1`; see [The ears](voice.md#the-ears).

Implement `BrainProvider`, register it in `packages/core/src/providers/registry.ts`, give it a
`SECRET_KEYS` entry if it takes a key, and pick it for Scout in Home. Do not widen the interface for a provider that is not being built.

## How to add a tool

Every built-in tool lives in `packages/core/src/tools/builtin/`, in one `Tool` shape (id, definition,
`read` or `write`, run), and reaches a turn through `ToolRegistry` in `tools/registry.ts`. The repo
skill [`.claude/skills/tagalong-add-tool/SKILL.md`](../.claude/skills/tagalong-add-tool/SKILL.md)
walks through it: which file, read versus write, testing with `fakeTurnTools`, registering, and the
docs to update. The design is in [Roles and tools](mind.md#roles-and-tools) in mind.md.

## Conventions

- **Test first.** Write the failing test, make it pass, refactor. No production code without a test that
  motivated it.
- **Never overengineer.** Build what the current task needs. Interfaces exist only where a second
  implementation is already planned.
- **Core stays pure.** `packages/core` and `packages/protocol` must not import `electron`, `react`, or
  browser globals. An ESLint `no-restricted-imports` rule enforces it.
- **Tools go through the registry.** `conversation/` and `engine.ts` import tools only from
  `tools/registry` or the `tools` index, never from `tools/builtin/*`. ESLint enforces it too.
- **Docs are part of done.** Update `README.md`, the subsystem doc in `docs/` that describes the
  code you changed (the [index](README.md) lists them), and `docs/testing/feature-test-guide.md`
  with every change.
- **Comments.** Every file opens with a 2-6 line header: what it is for, what it contains, who uses
  it. Comments explain why, limits, units and parse-compat rules; phase numbers, PR references and
  history belong in git. Test files get a one-line header.
- **Commits** use Conventional Commits, for example `feat(core): add PromptAssembler`.
- **Diagrams** are Mermaid only, and every block starts with the monochrome init line the docs
  share (copy it from any doc in `docs/`): grey lines and titles, so diagrams read on GitHub's light
  and dark themes.

## Voice models

The ears use three models, about 43 MB in all (43,001,836 bytes). They are not shipped in the
installer. The first time listening is used, `bodies/desktop/src/main/voice/ears/model-files.ts`
downloads the missing files into the voice folder, each streamed to a `.part` file, hashed as it
arrives and renamed only when it is complete and matches, so an interrupted or damaged download
never looks done. Each file is pinned to one
Hugging Face commit and checked against a SHA-256 in that file; `KOKORO_FILES` does the same for
the voice (92,364,770 bytes). Nothing is fetched at launch or
in tests. Audio is never sent anywhere; only these model files are downloaded.

| File                                                                          | Source                               | Bytes          | Licence      |
| ----------------------------------------------------------------------------- | ------------------------------------ | -------------- | ------------ |
| `ears/silero-vad/model.onnx`                                                  | `onnx-community/silero-vad`          | 2,243,022      | MIT          |
| `onnx-community/moonshine-tiny-ONNX/config.json`                              | `onnx-community/moonshine-tiny-ONNX` | 921            | MIT          |
| `onnx-community/moonshine-tiny-ONNX/generation_config.json`                   | `onnx-community/moonshine-tiny-ONNX` | 147            | MIT          |
| `onnx-community/moonshine-tiny-ONNX/preprocessor_config.json`                 | `onnx-community/moonshine-tiny-ONNX` | 128            | MIT          |
| `onnx-community/moonshine-tiny-ONNX/tokenizer.json`                           | `onnx-community/moonshine-tiny-ONNX` | 3,761,754      | MIT          |
| `onnx-community/moonshine-tiny-ONNX/tokenizer_config.json`                    | `onnx-community/moonshine-tiny-ONNX` | 135,735        | MIT          |
| `onnx-community/moonshine-tiny-ONNX/onnx/encoder_model_quantized.onnx`        | `onnx-community/moonshine-tiny-ONNX` | 7,937,661      | MIT          |
| `onnx-community/moonshine-tiny-ONNX/onnx/decoder_model_merged_quantized.onnx` | `onnx-community/moonshine-tiny-ONNX` | 20,243,286     | MIT          |
| `ears/smart-turn-v3/smart-turn-v3.2-cpu.onnx`                                 | `pipecat-ai/smart-turn-v3`           | 8,679,182      | BSD-2-Clause |
| **Total**                                                                     |                                      | **43,001,836** |              |

Silero VAD (MIT) spots speech, Moonshine tiny (MIT) turns it into text through transformers.js, and
Smart Turn (BSD-2-Clause) decides when a turn has ended. The Moonshine files sit in the
transformers.js cache layout under the voice folder, the same cache Kokoro uses. The byte counts are
exact at the pinned commit. To bump a model, pick the new commit, read each file's SHA-256 from
`https://huggingface.co/api/models/<repo>/tree/<commit>` (the LFS `oid`; hash a small non-LFS file
at that commit and check it against its git blob `oid`), and change the URL, `bytes` and `sha256`
together. The static test in `model-files.test.ts` rejects a `resolve/main` URL.

## Known gaps

Gaps that are real in the code on `main`, each explained in the doc it links to.

- **No Fast Refresh in dev.** The renderer uses Vite's esbuild JSX transform, not
  `@vitejs/plugin-react`. See [desktop.md](desktop.md#bundling-the-workspace-packages).
- **Windows only, unsigned installer.** There is no macOS or Linux platform adapter, so the app
  stops at launch there; the Windows installer is unsigned. See
  [desktop.md](desktop.md#the-platform-adapter) and [desktop.md](desktop.md#packaging).
- **Real voice models are not run in CI.** Tests and the Electron suites use `TAGALONG_FAKE_TTS=1`
  and `TAGALONG_FAKE_STT=1`, so model downloads, synthesis and transcription run only on a real
  machine. See [voice.md](voice.md#tests-that-pin-it).
