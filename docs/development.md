# Developer guide

How to build, run, test and package Tagalong from source, and the conventions the code follows. For how it works inside, start at [architecture.md](architecture.md); the [docs index](README.md) lists every subsystem doc.

## Repository layout

A pnpm workspace monorepo. One core engine, many thin hosts.

```text
tagalong/
  package.json                      # pnpm workspace root (private)
  pnpm-workspace.yaml
  tsconfig.base.json                # plus tsconfig.json and tsconfig.tests.json
  vitest.config.ts                  # projects: packages/*, apps/*; coverage thresholds
  eslint.config.js
  .github/workflows/ci.yml          # changes, build (Linux), e2e (Windows)
  docs/
    README.md                       # the index and reading order
    architecture.md, protocol.md    # the whole system; the wire protocol
    desktop.md, bubble.md, voice.md, browser-extension.md   # the hosts
    sight.md, mind.md, memory.md, experts.md, asks.md, routines.md,
    connected-apps.md               # the engine's subsystems
    settings-and-secrets.md, storage.md, privacy.md, development.md
    testing/feature-test-guide.md   # manual tests
    chrome-web-store/               # store listing kit and the extension's privacy policy
  protocol/                         # contract v1 for the Python brain (README.md is the spec)
    examples/                       # sample frames shared by the TypeScript and Python tests
    ts/                             # @tagalong/contract: zod schemas for contract v1
  brain/                            # the Python brain: uv project, tests/; src/brain/ has protocol.py,
                                    # config.py, bodies.py, server.py and main.py (see docs/brain.md)
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
    ui/src/
      index.ts, host-bridge.ts      # HostBridge contract and its React context
      dock-pet.tsx, companion-bubble.tsx, message-list.tsx, composer.tsx, sight-bar.tsx, chat-panel.tsx
      handoff-card.tsx, connector-confirm.tsx, routine-card.tsx, settings-card.tsx, drop-card.tsx,
      pick-up-card.tsx, health-card.tsx, status-mark.tsx, answer.tsx
      home/                         # Home: HomeView and its pages (Experts, Routines, Connections, Activity,
                                    # Waiting on you, What Scout saw, remembers and learned, How Scout decided, Spend)
      settings/settings-styles.ts   # the Settings sheet's styles
      voice/                        # push to talk, the listen controller, the speech queue, what is spoken aloud
      theme/                        # design tokens, BeanClip (a strip of Bean frames, moving or still)
      test-support/fake-host-bridge.ts
  apps/
    desktop/
      electron.vite.config.ts       # main / preload / renderer builds
      playwright.config.ts
      electron-builder.json         # installer config: NSIS (Windows), dmg, AppImage, deb
      scripts/ensure-electron.mjs   # fetches the Electron binary
      scripts/fetch-native.mjs      # fetches get-windows' prebuilt binding before packaging
      scripts/start-fresh.mjs       # runs the app on a new temp data folder
      e2e/                          # smoke, first-run, launch-greeting, hotkey-recovery, listening
                                    # (Always listening) and cards.spec.ts (the hand-off, connector
                                    # confirm and routine cards)
      e2e/fixtures/notes-mcp.mjs    # a tiny stdio MCP server with one write tool, for cards.spec.ts
      src/main/                     # index.ts, engine-host.ts, engine-client.ts, context.ts,
                                    # hotkeys.ts, talk-key.ts, always-listening.ts, secret-store.ts,
                                    # tray-icon.ts, tray-menu.ts, welcome.ts, launch.ts,
                                    # claude-sign-in.ts, keep-an-eye.ts, sight-pause.ts, drop.ts,
                                    # routine-delivery.ts, log-file.ts, links.ts, awareness/, ipc/,
                                    # platform/, voice/, windows/
      src/main/voice/               # voice.ts (the mouths), kokoro.ts, elevenlabs.ts, ears/ (models, LocalEars)
      src/main/voice/worker/        # the voice process: client.ts (VoiceWorker), messages.ts,
                                    # handler.ts, ears-host.ts, worker-local-voice.ts, main.ts (its bootstrap)
      src/main/platform/            # capture, downscale, composite, canvas, label, displays, ocr,
                                    # read-text, text-layer, find-element, sight-gate,
                                    # window-helper, window-list, window-shot, selection, win32
      src/main/windows/             # one module per window: avatar, panel, home, settings, welcome, pointer
      src/preload/index.ts          # exposes window.tagalong and window.tagalongHost
      src/renderer/                 # avatar (Scout), panel (the bubble), welcome (Welcome),
                                    # home (Home), settings (Settings) and pointer HTML, src/*.tsx
      src/renderer/src/settings/    # the Settings page, one file per section
      src/renderer/src/bean/        # Bean's WebP strips and manifest.json
      src/renderer/src/bean-assets.ts # FIGURE: the strips bundled once for the dock, Home and Welcome
      scripts/bean/                 # bean.py (Blender) and pack.py: regenerate Bean's strips
      src/shared/ipc.ts             # IPC channel names and the host-only API type
    extension/                      # Chrome MV3 host, built by Vite into dist/ (load unpacked)
      src/manifest.ts               # the manifest as data; the build writes dist/manifest.json
      src/service-worker.ts         # Chrome glue: engine socket, side panel, shortcut
      src/sidepanel/, src/options/  # side panel (packages/ui) and the pairing page
      src/content/page-reader.ts    # injected on demand: selection, URL, title, page text
```

| Package             | Responsibility                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Zod schemas for context snapshots, pets, messages, settings, and JSON-RPC, plus the method catalog. Depends only on zod.                                                                                    |
| `packages/core`     | The Tagalong Engine: Scout, conversation runner, prompt assembly, SQLite memory, experts and hand-offs, connected apps (MCP client), routines, host protocol server, pairing, provider adapters. Pure Node. |
| `packages/ui`       | React components shared by hosts: `DockPet`, `CompanionBubble` and its cards, `ChatPanel` (with its internal `MessageList`, `Composer` and `SightBar`), Home's `HomeView`, and the `HostBridge` context.    |
| `apps/desktop`      | Electron host. Runs the engine in the main process, dials it over the loopback socket, and owns Scout's window, the bubble, Home, Welcome, the tray, hotkeys, secret storage, and Scout's voice and ears.   |
| `apps/extension`    | Chrome MV3 host. Connects to the running engine and speaks the protocol only. Side panel, pairing page, on-demand page reader, and the open-panel shortcut.                                                 |

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

Inside `apps/desktop`:

```bash
pnpm build            # ensure-electron, then electron-vite build into dist/
pnpm start            # ensure-electron, then electron-vite preview against the built output
pnpm start:fresh      # the same, on a new temp data folder: Welcome and the first hello, every time
pnpm test:e2e         # ensure-electron, electron-vite build, then the Playwright smoke suite
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

| Area                                                   | Floor (statements / branches / functions / lines) |
| ------------------------------------------------------ | ------------------------------------------------- |
| `packages/core/src`                                    | 70 / 70 / 70 / 70                                 |
| `packages/protocol/src`                                | 70 / 70 / 70 / 70                                 |
| `packages/ui/src`                                      | 91 / 83 / 90 / 93                                 |
| `apps/desktop/src/main` and `apps/desktop/src/preload` | 59 / 62 / 49 / 60                                 |

The `packages/ui` and desktop host floors sit just below what they measured when they were added.
Raise them when coverage grows; never lower them to make a change pass. The desktop renderer and
the extension are not measured: the Playwright suites cover them.

Inside `packages/core`:

```bash
pnpm gen:roles        # compile roles/*.md, soul/*.md and constitution.md into src/roles/library.generated.ts (commit the result)
```

Run `pnpm --filter @tagalong/core gen:roles` from the root (or `node scripts/gen-roles.mjs` from
`packages/core`, which also works in a git worktree) after editing any file in
`packages/core/roles/` or `packages/core/soul/`, or `packages/core/constitution.md`. It needs `packages/protocol` built first, because it validates each role
against the protocol's `Role` schema. A test fails while the generated file is stale.

### Packaging

`apps/desktop/electron-builder.json` drives every installer; the output lands in
`apps/desktop/release/`.

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
- **The Chrome extension ships inside.** `apps/extension/dist` is copied to `resources/extension`, so
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

The `e2e` CI job runs the Electron end-to-end suites. `apps/desktop/e2e/` holds six Playwright suites
that launch the built app: `smoke.spec.ts` (the bubble, talking, capture, pause, hotkeys, Welcome on
request, Home),
`first-run.spec.ts` (Welcome and Scout's intro on an empty data folder), `launch-greeting.spec.ts`
(the launch across launches on one profile), `hotkey-recovery.spec.ts`
(a key another app owns), `listening.spec.ts` (Always listening: off at launch, switched on, a turn
that starts with "Scout" is heard and answered, switched off) and `cards.spec.ts`. Run them with `pnpm --filter @tagalong/desktop
test:e2e`.

The suites run offline on fakes: `TAGALONG_FAKE_PROVIDERS=1` (a scripted brain and a scripted expert),
`TAGALONG_FAKE_TTS=1`, `TAGALONG_FAKE_STT=1`, `TAGALONG_FAKE_SIGN_IN` (the Claude Code sign-in check reads as the state it names), and `TAGALONG_FAKE_TOOL` with `TAGALONG_FAKE_TOOL_INPUT`,
which make the fake brain call one tool before it answers. `cards.spec.ts` uses the last pair to bring
up each card: `hand_to_expert`, a connected app's `notes__add_note`, and `create_routine`. Each card
gets its own launch, since the tool is read once at start. The native folder picker is stubbed
through `app.evaluate`, so the hand-off card's Browse picks a temporary folder. When an e2e suite
fails in CI, its `test-results` folder (page snapshots and screenshots) is uploaded as the
`e2e-test-results` artifact.

Quit any running Tagalong before `pnpm test:e2e`. The main process takes a single-instance lock, so a
second copy quits immediately and Playwright reports the confusing
`electron.launch: Target page, context or browser has been closed` instead of naming the real cause.

The smoke suite saves screenshots of Home to `apps/desktop/test-results/` (gitignored) for design
review: `home.png`, `connections.png` and `routines.png`.

## Running the desktop app

PowerShell (the primary dev shell on Windows):

```powershell
pnpm install
$env:TAGALONG_FAKE_PROVIDERS = '1'
pnpm dev:desktop
```

bash (Git Bash, WSL, macOS, Linux):

```bash
pnpm install
TAGALONG_FAKE_PROVIDERS=1 pnpm dev:desktop
```

PowerShell has no inline `VAR=value command` prefix; pasting the bash line into PowerShell fails with
`TAGALONG_FAKE_PROVIDERS=1 : The term ... is not recognized`.

On a fresh profile Welcome opens first; **Start** finishes it, and **Home → Settings → Open Welcome
again** brings it back. To see what a new user sees, run `pnpm --filter @tagalong/desktop
start:fresh`: it starts on a new folder in the temp directory (`--user-data-dir`), so Welcome and
Scout's first hello show every time and your own `%APPDATA%\Tagalong` is never touched. Quit any
running Tagalong first; the fresh copy has no saved keys. The tray's **Open Tagalong** item opens Home. Two more things are worth knowing before the first run.

**`ensure-electron`.** Electron 44.3.0 publishes no npm install script, so `pnpm install` unpacks the
package without ever downloading the platform binary, and the first launch dies with an error that
reads like a broken machine. `apps/desktop/scripts/ensure-electron.mjs` runs the Electron package's own
`install.js` when `dist/` is missing, and it is wired into the `dev`, `build`, and `start` scripts — so
you normally never call it yourself.

**`TAGALONG_FAKE_PROVIDERS=1`.** With this set, `createProvider` returns the scripted
`FakeBrainProvider` whatever settings say: no API key, no network, and a deterministic word-by-word
stream. Hand-offs go to a scripted expert, so no Claude Code usage is spent. It is how the
Playwright suites run, and the easiest way to see the app work before you have a key. Keeping an eye
on things is off under it unless `TAGALONG_KEEP_AN_EYE=1` is set too, and no window the engine lists
counts as full screen, so the CI desktop never holds a check-in (the launch one included). Without
it, Scout asks the provider it names, with that provider's key from the OS keychain. A fresh install's Scout thinks
with the Claude sign-in (`claude-code`, Sonnet), which needs Claude Code installed and signed in;
Welcome offers a keyed provider instead. The engine itself boots without any key.

### Choosing Scout's brain

Home's Scout page picks Scout's **provider** (each says whether it needs a key) and **model**.
Keys live in **Settings → Advanced → API keys**: one row per keyed provider, with Add or Replace
key, a base URL box for each OpenAI-compatible preset, and **Remove key**. Settings' **How Scout
thinks** card shows the brain Scout really uses and whether the Claude Code sign-in works
(`claude auth status --json`, run locally with no model call).

| Provider      | Base URL (overridable)         | Key                  | Models                                          |
| ------------- | ------------------------------ | -------------------- | ----------------------------------------------- |
| `claude-code` | none: runs the `claude` CLI    | your Claude sign-in  | `haiku`, `sonnet`, `opus`                       |
| `openrouter`  | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | anything OpenRouter serves, e.g. a Claude model |
| `anthropic`   | the Anthropic API              | Anthropic key        | Claude, directly                                |
| `fake`        | none                           | none                 | scripted, offline                               |

The OpenRouter preset goes through `OpenAiCompatibleProvider`, so any other OpenAI-format service is
a settings change: put its URL in the base URL box, store its key, and type its model id. The
model box suggests ids from the service's own `GET /models` once a key is stored, and says when it is
showing the built-in list instead.

**Pictures.** A turn that carries a picture — a screenshot, or an image a tool such as
`look_closer` returns — goes to Scout's own model. Every built-in provider sees; on a provider that
cannot (`capabilities.vision` false), pixels are never sent: the screenshot is dropped with a
warning.

Scout's provider and model apply on its next ask, and so does a new key or base URL: the engine
re-reads the keychain before every ask, so no restart is needed.

The OpenRouter fallback ids are a static list in `packages/core/src/providers/presets.ts`. The live
list in Settings is the authority.

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

In the Chrome side panel, the sight bar shows roughly what the attached pictures cost — `~1,843
image tokens · 3 images` — at width × height ÷ 750 per image.

The budget is a ceiling, not a target — Scout asks for less when it only needs the top of a
terminal, and the number it does not ask for is the one set here.

Capture is never silent. Every capture, including one Scout's own tool asked for, shows on Scout
and updates the tray tooltip to say what was read and when. Before any screenshot the host checks the
focused window against the capture exclusions in settings (password managers and the Windows
credential prompts by default); when one matches, no picture is taken at all and the bubble is told
that capture is blocked here, naming only the exclusion entry that matched.

### The pairing token

On boot the engine writes a 32-byte hex token to `pairing.token` in its data dir, alongside
`tagalong.db`, `settings.json`, and `secrets.json`. On Windows that directory is
`%APPDATA%\Tagalong`, which is `productName` in `apps/desktop/package.json` — Electron derives the
data directory from it, and changing it moves everyone's settings, database and saved keys with no
migration. The token is stable across restarts, so a host that has already paired does not have to
pair again.

Every host must present that token in its `hello` call. A connection that sends anything else gets
RPC error `-32000` and the socket is closed; a connection that calls any other method before `hello`
gets the same error.

The token exists because **loopback is not a permission boundary**. Any process running as the user
can open a socket to `127.0.0.1:47321` — binding to loopback only keeps other machines out, not other
programs on this one. Without the token, any local program could drive Scout, read the user's
conversations, and spend their API budget. Comparison is constant-time, because a plain `===` leaks
the length of the shared prefix through timing.

## The Chrome extension in detail

The extension is a second host for the same engine: same Scout, same memory, same settings. It gives
Scout the **exact** selection and the readable text of the page you are on, and puts Scout in
Chrome's side panel.

**It needs the desktop app running.** The extension holds no engine of its own; it connects to the
one inside the Tagalong desktop app on `ws://127.0.0.1:47321`. With the app closed, the side panel
says "Disconnected … Is the Tagalong app running?" and reconnects by itself — within a second or two
with the panel open, within about thirty seconds without.

### Build and load it

```bash
pnpm install
pnpm --filter @tagalong/extension build    # writes apps/extension/dist
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Pin Tagalong from the puzzle-piece menu so its toolbar button is visible.

After a rebuild, click the reload arrow on the Tagalong card in `chrome://extensions`.

### Pair it, once

1. In the desktop app, open the Settings window (tray → **Open Tagalong** → **Settings**). In its
   **Browser extension (optional)** section, click **Copy** beside the pairing token. How pairing
   works is in [browser-extension.md](browser-extension.md#pairing).
2. Chrome opens the extension's options page on first use (or right-click the toolbar button →
   **Options**). Paste the token and click **Save and connect**. Leave the port empty unless you
   moved the engine off `47321`.
3. The options page says "Connected to Tagalong …". The token is stored in this browser's local
   extension storage only, never synced.

### Use it

| Do this                                     | What happens                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Click the toolbar button                    | The side panel opens with Scout and attaches the page it opened beside (selection, title, readable text).                   |
| Select text, press `Alt+Shift+Space`        | The side panel opens with that exact selection and the page title in the sight bar.                                         |
| Press the desktop hotkey `Ctrl+Shift+Space` | The desktop bubble opens as usual; when Chrome is in front, the engine swaps in the exact selection and adds the page text. |
| Click **Read this page** / **Clear**        | Re-reads the tab, or sends the next ask with nothing attached.                                                              |

`Ctrl+Shift+Space` stays the desktop app's: it is a global hotkey and Chrome never sees it, so the
extension's own shortcut is `Alt+Shift+Space`. Rebind it at `chrome://extensions/shortcuts`.

The extension reads a tab only after you use it there (Chrome's `activeTab`). To let it read
whichever tab is in front when you ask — including from the desktop hotkey — click **Allow reading
any tab when I ask** on its options page. It still reads nothing until you ask.

### Publish it

The Chrome Web Store listing text, permission justifications, data disclosures, image list and
submission steps are in [docs/chrome-web-store/listing.md](chrome-web-store/listing.md). The
public privacy policy is [docs/chrome-web-store/privacy-policy.md](chrome-web-store/privacy-policy.md).

## Environment variables

`.env.example` is a **reference list of the variables the project uses**, not a file the app loads.
Nothing reads `.env.local`: there is no dotenv dependency, and no code in `packages/` or `apps/`
opens a `.env` file. Copying it therefore changes nothing at runtime.

Eight environment variables are read, all straight from the process environment. **Set them in the
shell you launch from**, as shown above.

| Variable                    | Status                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAGALONG_FAKE_SIGN_IN`     | **Read** (`apps/desktop/src/main/claude-sign-in.ts#fakeSignIn`), in any build. One of `signed-in`, `signed-out`, `not-installed` or `unknown` stands in for the Claude Code sign-in check, so no claude binary runs. Under `TAGALONG_FAKE_PROVIDERS=1` the check reads as `signed-in` unless this says otherwise.                                                                                          |
| `TAGALONG_FAKE_PROVIDERS=1` | **Read** (`packages/core/src/providers/registry.ts`, `engine.ts`). Forces the fake brain and a fake expert, for tests and demos. No keys, network or Claude Code usage.                                                                                                                                                                                                                                    |
| `TAGALONG_FAKE_TOOL`        | **Read** (`providers/registry.ts`). Under the fake brain, the name of one tool it calls before it answers. `cards.spec.ts` and the smoke suite set it.                                                                                                                                                                                                                                                     |
| `TAGALONG_FAKE_TOOL_INPUT`  | **Read** (`providers/registry.ts`). The JSON input for that tool call; bad JSON means no input.                                                                                                                                                                                                                                                                                                            |
| `TAGALONG_KEEP_AN_EYE=1`    | **Read** (`apps/desktop/src/main/keep-an-eye.ts`). Keeps an eye on things under the fake brain, where it is otherwise off.                                                                                                                                                                                                                                                                                 |
| `TAGALONG_SKIP_WELCOME=1`   | **Read** (`apps/desktop/src/main/welcome.ts`). Keeps Welcome shut. The Electron suites other than first-run set it.                                                                                                                                                                                                                                                                                        |
| `TAGALONG_FAKE_TTS=1`       | **Read** (`voice/voice.ts`). Scout's voice becomes a short silent clip: no model download, no ElevenLabs call, no sound. Every Electron suite sets it.                                                                                                                                                                                                                                                     |
| `TAGALONG_FAKE_STT=1`       | **Read** (`voice/worker/main.ts`, `main/index.ts`). The voice process uses the fake ears: a held question is heard as "What am I looking at?" every time, and in always mode (`FAKE_TURN_FRAMES` frames of the fake microphone end one turn) as "Scout, what am I looking at?", with no speech model download; Chromium's fake microphone stands in for a real one. The smoke and listening suites set it. |
| `ANTHROPIC_API_KEY`         | **Not read.** The key for the `anthropic` BrainProvider is entered in Settings and stored via Electron `safeStorage`, never taken from the environment.                                                                                                                                                                                                                                                    |
| `OPENROUTER_API_KEY`        | **Not read.** The key for the `openrouter` provider, entered in Settings and stored like the Anthropic key.                                                                                                                                                                                                                                                                                                |
| `ELEVENLABS_API_KEY`        | **Not read.** The optional ElevenLabs voice's key is entered in Settings → Advanced and stored like the others (`elevenlabs.apiKey`).                                                                                                                                                                                                                                                                      |

Secrets never enter git. In the app they live in the OS keychain through Electron `safeStorage`, written
as ciphertext to `secrets.json`; if the OS has no encryption backend the store refuses to write at all
rather than leaving a key readable on disk.

## How to add a host

A host is anything that can show Scout and capture what the user is looking at: the Electron app, the
Chrome extension, or something new. Adding one never touches the core.

1. Implement the **Perception** contract: answer `perception.capture` for selection, active window,
   clipboard, page text and screenshot, returning a `ContextSnapshotPatch` from
   `packages/protocol`. Advertise only what you can actually read, in the `capabilities` array of
   `hello`.
2. Implement the **Presentation** contract: render Scout, stream reply deltas, and show the cards.
   The shared React components in `packages/ui` do this already — hand them a `HostBridge` and nothing
   else.
3. Speak the JSON-RPC protocol over the localhost WebSocket the engine exposes
   (`ws://127.0.0.1:47321` by default), presenting the pairing token in `hello`. The method catalog and
   every payload schema live in `packages/protocol`.
4. Never import core internals. A host uses the protocol, and the engine's public API only where it
   embeds the engine in process. `apps/extension` imports nothing from core at all.

## How to add a provider

Providers are the swappable edges of the engine. Each one is an interface in `packages/core` with more
than one planned implementation.

- **BrainProvider** for the AI engine. Existing: `claude-code` (the Claude sign-in, through the
  `claude` CLI), `openrouter` (a preset of the OpenAI-compatible `OpenAiCompatibleProvider`),
  `anthropic`, and `fake` (tests and demos). Another OpenAI-format
  service needs no code — see [Choosing Scout's brain](#choosing-scouts-brain); a new named preset
  is one entry in `packages/core/src/providers/presets.ts`.
- **Text to speech** lives in the desktop host, not in core: `Tts` in
  `apps/desktop/src/main/voice/voice.ts` (`speak(text, { voice, speed })` returns encoded audio),
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
installer. The first time listening is used, `apps/desktop/src/main/voice/ears/model-files.ts`
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

- **No Tailwind build.** `@tagalong/ui`'s chat parts (`ChatPanel`, `MessageList`, `Composer`,
  `SightBar`) use Tailwind utility classes, but neither host ships Tailwind; `app.css` (desktop) and
  `sidepanel.css` (extension) hand-write the structure instead. See [bubble.md](bubble.md) and
  [browser-extension.md](browser-extension.md).
- **No cards in the Chrome side panel.** It draws no hand-off, connector confirm or routine card;
  only the desktop bubble does. See [browser-extension.md](browser-extension.md).
- **No Fast Refresh in dev.** The renderer uses Vite's esbuild JSX transform, not
  `@vitejs/plugin-react`. See [desktop.md](desktop.md#bundling-the-workspace-packages).
- **Windows only, unsigned installer.** There is no macOS or Linux platform adapter, so the app
  stops at launch there; the Windows installer is unsigned. See
  [desktop.md](desktop.md#the-platform-adapter) and [desktop.md](desktop.md#packaging).
- **Real voice models are not run in CI.** Tests and the Electron suites use `TAGALONG_FAKE_TTS=1`
  and `TAGALONG_FAKE_STT=1`, so model downloads, synthesis and transcription run only on a real
  machine. See [voice.md](voice.md#tests-that-pin-it).
