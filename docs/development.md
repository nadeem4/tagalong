# Developer guide

How to build, run, test and package Tagalong from source, and the conventions the code follows. For how it works inside, see [architecture.md](architecture.md) and [concepts/](concepts/).

## Repository layout

A pnpm workspace monorepo. One core engine, many thin hosts.

```text
tagalong/
  package.json                      # pnpm workspace root (private)
  pnpm-workspace.yaml
  tsconfig.base.json                # plus tsconfig.json and tsconfig.tests.json
  vitest.config.ts                  # projects: packages/*, apps/*; coverage thresholds
  eslint.config.js
  .github/workflows/ci.yml
  docs/
    architecture.md
    acceptance/                     # per-phase sign-off
    specs/2026-09-11-tagalong-design.md
  packages/
    protocol/src/
      index.ts                      # PROTOCOL_VERSION, ENGINE_HOST, DEFAULT_ENGINE_PORT, engineUrl
      context.ts                    # ContextSnapshot, CapturedImage, DisplaySnapshot, WindowEntry,
                                    # ContextSnapshotPatch, PerceptionTarget
      pet.ts                        # Pet, ReplyStyle
      message.ts                    # Conversation, Message, MessageContent
      rpc.ts                        # JSON-RPC envelopes and error codes
      settings.ts                   # Settings, SettingsPatch, SETTINGS_DEFAULTS
      methods.ts                    # the method and notification catalog
    core/src/
      index.ts                      # the public facade hosts import
      engine.ts                     # Engine.boot: wires the parts together and listens
      conversation/                 # ConversationRunner, prompt-assembler
      perception/                   # exclusions, retention, tools, inventory
      memory/                       # db.ts (numbered migrations), store.ts (ConversationStore)
      pets/registry.ts              # PetRegistry, the default pet Scout
      providers/                    # brain.ts, anthropic.ts, openai-compatible.ts, presets.ts, nebius-models.ts, vision-routing.ts, fake.ts, registry.ts, errors.ts
      server/                       # ws-server.ts (EngineServer), pairing.ts
      settings/settings.ts          # SettingsStore, SecretStore, InMemorySecretStore
    ui/src/
      index.ts, host-bridge.ts      # HostBridge contract and its React context
      pet-avatar.tsx, message-list.tsx, composer.tsx, sight-bar.tsx, chat-panel.tsx
      test-support/fake-host-bridge.ts
  apps/
    desktop/
      electron.vite.config.ts       # main / preload / renderer builds
      playwright.config.ts
      electron-builder.json         # installer config: NSIS (Windows), dmg, AppImage, deb
      scripts/ensure-electron.mjs   # fetches the Electron binary
      scripts/fetch-native.mjs      # fetches get-windows' prebuilt binding before packaging
      e2e/smoke.spec.ts
      src/main/                     # index.ts, engine-host.ts, engine-client.ts, context.ts,
                                    # hotkeys.ts, secret-store.ts, tray-icon.ts, onboarding.ts,
                                    # links.ts, platform/, windows/
      src/main/platform/            # capture, downscale, composite, canvas, label, displays,
                                    # window-helper, window-list, selection, win32
      src/preload/index.ts          # exposes window.tagalong and window.tagalongHost
      src/renderer/                 # avatar/panel/settings/onboarding HTML, src/*.tsx, app.css
      src/shared/ipc.ts             # IPC channel names and the host-only API type
    extension/                      # Chrome MV3 host, built by Vite into dist/ (load unpacked)
      src/manifest.ts               # the manifest as data; the build writes dist/manifest.json
      src/service-worker.ts         # Chrome glue: engine socket, side panel, shortcut
      src/sidepanel/, src/options/  # side panel (packages/ui) and the pairing page
      src/content/page-reader.ts    # injected on demand: selection, URL, title, page text
```

| Package             | Responsibility                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Zod schemas for context snapshots, pets, messages, settings, and JSON-RPC, plus the method catalog. Depends only on zod.                                                                                          |
| `packages/core`     | The Tagalong Engine: pets, conversation runner, prompt assembly, SQLite memory, host protocol server, pairing, provider adapters. Pure Node. Voice, the inter-pet bus, and the MCP client arrive in later phases. |
| `packages/ui`       | React components shared by hosts: `PetAvatar`, `MessageList`, `Composer`, `SightBar`, `ChatPanel`, and the `HostBridge` context.                                                                                  |
| `apps/desktop`      | Electron host. Runs the engine in the main process, dials it over the loopback socket, and owns the avatar, panel, settings window, tray, hotkey, and secret storage.                                             |
| `apps/extension`    | Chrome MV3 host. Connects to the running engine and speaks the protocol only. Side panel, pairing page, on-demand page reader, and the open-panel shortcut.                                                       |

## How to run

Prerequisites:

- Windows 11 (primary dev target; macOS and Linux arrive in Phase 7 — `createPlatform` throws on any
  other platform today)
- Node.js 22 or newer (`node -v`)
- pnpm 10 — the root `packageManager` field pins the exact version. Two ways to get it:
  - `corepack enable` — only works from an **elevated** shell. From a normal shell on Windows it fails
    with `Internal Error: EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm.ps1'`
    (the filename varies: `yarnpkg`, `pnpm.cmd`, and so on). If you see that, use the next line.
  - `npm install -g pnpm@10` — installs into the user-level npm prefix and needs no elevation. This is
    what the current machine uses.
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
pnpm test:coverage   # Vitest with v8 coverage; packages/core and packages/protocol must stay above 70%
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
pnpm test:e2e         # ensure-electron, electron-vite build, then the Playwright smoke suite
pnpm ensure-electron  # fetch the Electron binary on its own
pnpm package:win      # fetch-native, electron-vite build, electron-builder --win nsis
pnpm package:dir      # an unpacked app in release/, for checking what gets packaged
```

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
- **Only the native modules are packaged.** The workspace packages are bundled into `dist/` by
  electron-vite, so they are `devDependencies`; the desktop's `dependencies` are exactly the three
  native modules electron-builder copies.
- **The Chrome extension ships inside.** `apps/extension/dist` is copied to `resources/extension`, so
  someone with only the installer can still load it unpacked. `pnpm package:win` from the root builds
  it first.
- **macOS dmg and Linux AppImage/deb are configured but unverified**, and would not run anyway: there
  is no macOS or Linux platform adapter in this build.
- CI does not build the installer yet. The two workflow steps that would (build it on
  `windows-latest`, upload it as the `tagalong-windows-installer` artifact) are in
  [docs/acceptance/phase-7.md](acceptance/phase-7.md#ci-steps-for-the-installer), to be added to
  `.github/workflows/ci.yml` by hand.

Quit any running Tagalong before `pnpm test:e2e`. The main process takes a single-instance lock, so a
second copy quits immediately and Playwright reports the confusing
`electron.launch: Target page, context or browser has been closed` instead of naming the real cause.

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

On a fresh profile the setup wizard opens first; **Skip setup** closes it for good, and the tray's
**Setup wizard** item brings it back. Two more things are worth knowing before the first run.

**`ensure-electron`.** Electron 44.3.0 publishes no npm install script, so `pnpm install` unpacks the
package without ever downloading the platform binary, and the first launch dies with an error that
reads like a broken machine. `apps/desktop/scripts/ensure-electron.mjs` runs the Electron package's own
`install.js` when `dist/` is missing, and it is wired into the `dev`, `build`, and `start` scripts — so
you normally never call it yourself.

**`TAGALONG_FAKE_PROVIDERS=1`.** With this set, `createProvider` returns the scripted
`FakeBrainProvider` whatever settings say: no API key, no network, and a deterministic word-by-word
stream. It is how the Playwright smoke suite runs, and the easiest way to see the app work before you
have a key. Without it, each pet asks the provider it names, with that provider's key from the OS
keychain. A fresh install's Scout runs on Nemotron through Nebius Token Factory, so until a Token
Factory key is stored its turns end with "No Token Factory API key is stored. Add one in Settings."
The engine itself boots without any key.

### Choosing a pet's brain

Settings shows, per pet, a **provider**, a **model id** and an optional **vision model id**, plus one
API key box per provider and a base URL box per OpenAI-compatible preset.

| Provider     | Base URL (overridable)                    | Key                  | Models                                                  |
| ------------ | ----------------------------------------- | -------------------- | ------------------------------------------------------- |
| `openrouter` | `https://openrouter.ai/api/v1`            | `OPENROUTER_API_KEY` | anything OpenRouter serves, e.g. a Claude model         |
| `nebius`     | `https://api.tokenfactory.nebius.com/v1/` | `NEBIUS_API_KEY`     | Nemotron 3 Super for text, Nemotron Nano 2 VL for sight |
| `anthropic`  | the Anthropic API                         | Anthropic key        | Claude, directly                                        |
| `fake`       | none                                      | none                 | scripted, offline                                       |

Both presets go through one `OpenAiCompatibleProvider`, so any other OpenAI-format service is a
settings change: put its URL in one of the base URL boxes, store its key, and type its model id. The
model box suggests ids from the service's own `GET /models` once a key is stored, and says when it is
showing the built-in list instead.

**Vision routing.** A turn that carries a picture — a screenshot, or an image a tool such as
`look_closer` returns — goes to the pet's model if that model can see, and otherwise to its vision
model. On Token Factory only Nemotron Nano 2 VL sees, so Scout answers words on Super and pictures on
Nano VL. On OpenRouter every model is treated as seeing, so a Claude pet answers everything on the one
model and needs no vision model. A pet with no model that can see never sends pixels: the screenshot
is dropped with a warning.

A pet's provider and model apply on its next ask, and so does a new key or base URL: the engine
re-reads the keychain before every ask, so no restart is needed.

The Nemotron Nano 2 VL id (`nvidia/Nemotron-Nano-V2-12b`) and the OpenRouter fallback ids could not be
checked when they were written; they live in `packages/core/src/providers/nebius-models.ts` and
`presets.ts`. The live list in Settings is the authority.

Once running: the pet sits on screen as a small always-on-top window, `Ctrl+Shift+Space` captures the
selection and the active window and opens the chat panel beside it, Escape or focus loss hides the
panel (unless a turn is still streaming), and the tray menu shows or hides the pets, opens settings,
and quits.

`Ctrl+Shift+S` does the same but also takes a screenshot of the active window, and
`Ctrl+Shift+Alt+S` captures everything: one picture per display, a composite laid out by monitor
geometry, and a list of every window that is open.

| Hotkey             | What rides along                                            | Roughly what it costs                       |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------- |
| `Ctrl+Shift+Space` | Selection and the active window                             | text only                                   |
| `Ctrl+Shift+S`     | Plus a screenshot of the active window                      | about 1,500 extra input tokens              |
| `Ctrl+Shift+Alt+S` | Plus the composite, the focused display and the window list | about 3,200, and a few seconds to enumerate |
| `Ctrl+Shift+Alt+P` | Nothing — turns all sight off, and on again                 | nothing                                     |

Three capture keys rather than one with modifiers, because they differ in what they cost and the
user is choosing the bill. The fourth takes sight away entirely — see
[Pausing sight](privacy.md#pausing-sight). A full-view capture attaches two pictures by default — the composite, which is
the map of how the monitors sit, and the display being worked on — and names the others in text so
the pet can fetch one by tool rather than everything by default. Three monitors must not mean three
images on every ask. **What a see-everything look sends** in the settings window overrides that and
attaches every display, for someone who would rather pay than ask twice.

All four accelerators are editable in the settings window and rebind while the app runs — no
restart — and an accelerator another application already owns is reported rather than silently
dropped, without costing the other three.

**A hotkey that cannot be registered never stops Tagalong from starting.** The only way to store an
accelerator Windows refuses is to type it into Settings, so an app that refused to open because of
one would leave you locked out of the window that fixes it, with the settings file as the only way
back. Instead the app starts, the other three keys work, and the failure appears in the panel and in
Settings naming which binding broke and what it was bound to. Correcting it takes effect
immediately, with no restart.

### The crew

A fresh install starts with three pets on three different brains: **Scout** (explainer, Nemotron 3
Super on Token Factory), **Ink** (writer, Claude through OpenRouter) and **Bolt** (coder, Nemotron Nano
2 VL on Token Factory). Each needs its provider's key; a pet whose key is missing says so on its turn
and the others keep working. Edit, add or delete pets in Settings. Deleting a default pet is permanent:
it is not re-seeded on the next boot.

The crew docks on the desktop as a strip of avatars, one per pet, that moves as one; click a pet to
open the panel on it. The panel header names the active pet in its colour, every answer is labelled
with the pet and the model that wrote it (`Ink · anthropic/claude-sonnet-5`), and:

| Do this                                   | What happens                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Type `@Ink draft a reply to this`         | Ink takes over in a new conversation with a summary of the thread and the page; a bubble shows it |
| Pick **Hand off…** under an answer        | The composer fills with `@Name ` so you can add the request                                       |
| Ask anything                              | A pet may consult another mid-answer (`ask_pet`); a small card says who it asked                  |
| Type `/crew <question>` or press **Crew** | Every pet answers in turn, seeing the others, and the pet you asked closes with a synthesis       |
| Press **Stop** during a roundtable        | The turn in flight stops and the rest are cancelled                                               |

Crew features multiply model calls, so the panel footer shows **N model calls** for any run that made
more than one. A roundtable of three pets costs four calls by default. Settings edits every pet — name,
emoji, colour, persona, provider, model, reply style, voice id (stored for Phase 3) — adds and deletes
pets, and chooses which pets show on the desktop strip.

Pets remember. Tell one "I prefer short answers" and it keeps that across restarts; a pet can also
save facts on its own, privately or in the crew notebook every pet reads. Memories live in the same
SQLite file as conversations (`tagalong.db` in the data dir).

### Awareness: rolling memory and watches

Two Phase 3B features let a pet know about time, not only about now. Both are in Settings, under
**Awareness**, and both take effect on save.

- **Rolling memory** (off by default). Turn it on and the desktop keeps the last few minutes — ten by
  default, at most thirty — of every screen in memory, so you can ask "what was I reading five
  minutes ago?". The pet answers with `recall_screen` and names the time of the frame it describes;
  `what_changed` shows it only the part of a screen that changed since a moment ago. A small red dot
  on the pets shows while it records.
- **Watches.** Ask "tell me when this finishes" and the pet calls `watch_for`. Tagalong compares the
  screen on this machine every five seconds and asks a model nothing until the watched region has
  changed and then held still; then one small, cheap model answers yes or no. On yes the panel shows
  the result as a card from the pet, a system notification pops up, and the pet's avatar shows an
  alert. A **Watching** chip in the panel counts the checks spent and has a **Stop** button. Watches are
  shown, not spoken, until Phase 3 (Voice) lands.

The check model is configurable per pet (Settings → the pet → **Watch check model**). Blank uses the
pet's provider's default, chosen to be small and cheap because a watch may ask it many times:

| Pet's provider | Default watch check model                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Token Factory  | `nvidia/nemotron-3-nano-30b-a3b` (Nemotron 3 Nano; reads the watched window's text, Nano VL for pixels) |
| OpenRouter     | `anthropic/claude-haiku-4.5`                                                                            |
| Anthropic      | `claude-haiku-4-5`                                                                                      |

A text-only check model such as Nemotron 3 Nano is handed the last 4,000 characters of the window that
was in front when the watch began — exactly what a terminal says — and a picture goes to the pet's vision
model only when there is no text to read. The Token Factory ids are unverified against the live model list;
the Settings picker shows the live one once a key is stored.

| Watch limit (Settings)         | Default | What it bounds                                    |
| ------------------------------ | ------- | ------------------------------------------------- |
| Checks per watch               | 60      | Model calls one watch may make before it gives up |
| Watches at once                | 3       | A fourth is refused, and the pet says so          |
| Timeout when the pet names one | 30 min  | How long a watch runs before it ends on its own   |

### The two cost controls

Both live in the settings window and both take effect on save, with no restart: they are read at the
moment of each capture rather than at boot.

| Setting                              | Default                            | What raising it costs                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What a see-everything look sends** | Composite plus the focused display | `Every screen` sends one picture per monitor, so a three-monitor desk pays roughly three times the image cost on every full-view look                                                   |
| **Window text budget**               | 8,000 characters                   | How much of a window a read returns when the pet does not ask for less. Roughly one token per four characters, so the default is about 2,000 tokens per read, and the ceiling is 40,000 |

Before you send, the sight bar shows roughly what the attached pictures cost — `~1,843 image tokens ·
3 images` — at width × height ÷ 750 per image, so a see-everything look on three monitors is visibly
dearer than a single screenshot.

The budget is a ceiling, not a target — a pet that only needs the top of a terminal asks for less,
and the number it does not ask for is the one set here.

Capture is never silent. Every capture, including one a pet's own tool asked for, badges the avatar
and updates the tray tooltip to say what was read and when. Before any screenshot the host checks the
focused window against the capture exclusions in settings (password managers and the Windows
credential prompts by default); when one matches, no picture is taken at all and the panel is told
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
programs on this one. Without the token, any local program could drive the user's pets, read their
conversations, and spend their API budget. Comparison is constant-time, because a plain `===` leaks
the length of the shared prefix through timing.

## The Chrome extension in detail

The extension is a second host for the same engine: same pets, same memory, same settings. It gives
pets the **exact** selection and the readable text of the page you are on, and puts the crew in
Chrome's side panel.

**It needs the desktop app running.** The extension holds no engine of its own; it connects to the
one inside the Tagalong desktop app on `ws://127.0.0.1:47321`. With the app closed, the side panel
says "Disconnected … Is the Tagalong app running?" and reconnects by itself — within a second or two
with the panel open, within about thirty seconds without. A headless engine service that runs without
the desktop app is a possible later option, recorded in the decisions log; it does not exist today.

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

1. In the desktop app, open **Settings** from the tray. Under **Browser extension**, click **Copy
   token**.
2. Chrome opens the extension's options page on first use (or right-click the toolbar button →
   **Options**). Paste the token and click **Save and connect**. Leave the port empty unless you
   moved the engine off `47321`.
3. The options page says "Connected to Tagalong …". The token is stored in this browser's local
   extension storage only, never synced.

### Use it

| Do this                                     | What happens                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Click the toolbar button                    | The side panel opens with the crew and attaches the page it opened beside (selection, title, readable text).                |
| Select text, press `Alt+Shift+Space`        | The side panel opens with that exact selection and the page title in the sight bar.                                         |
| Press the desktop hotkey `Ctrl+Shift+Space` | The desktop panel opens as before; when Chrome is in front, the engine swaps in the exact selection and adds the page text. |
| Click **Read this page** / **Clear**        | Re-reads the tab, or sends the next ask with nothing attached.                                                              |

`Ctrl+Shift+Space` stays the desktop app's: it is a global hotkey and Chrome never sees it, so the
extension's own shortcut is `Alt+Shift+Space`. Rebind it at `chrome://extensions/shortcuts`.

The extension reads a tab only after you use it there (Chrome's `activeTab`). To let it read
whichever tab is in front when you ask — including from the desktop hotkey — click **Allow reading
any tab when I ask** on its options page. It still reads nothing until you ask.

## Environment variables

`.env.example` is a **reference list of the variables the project will use**, not a file the app loads.
Nothing reads `.env.local` today: there is no dotenv dependency, and no code in `packages/` or `apps/`
opens a `.env` file. Copying it therefore changes nothing at runtime.

Two environment variables are read today, both straight from `process.env`: `TAGALONG_FAKE_PROVIDERS`
in `packages/core/src/providers/registry.ts`, and `TAGALONG_SKIP_ONBOARDING` in
`apps/desktop/src/main/onboarding.ts`. **Set them in the shell you launch from**, as shown above.

| Variable                     | Status today                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAGALONG_FAKE_PROVIDERS=1`  | **Read.** Forces the fake brain provider, for tests and demos. No keys or network needed. Must be set in the shell environment.                         |
| `TAGALONG_SKIP_ONBOARDING=1` | **Read.** Keeps the setup wizard shut. The Electron smoke tests set it; a person uses **Skip setup** instead.                                           |
| `ANTHROPIC_API_KEY`          | **Not read.** The key for the `anthropic` BrainProvider is entered in Settings and stored via Electron `safeStorage`, never taken from the environment. |
| `OPENROUTER_API_KEY`         | **Not read.** The key for the `openrouter` provider, entered in Settings and stored like the Anthropic key.                                             |
| `NEBIUS_API_KEY`             | **Not read.** The key for the `nebius` provider (Token Factory), entered in Settings and stored like the Anthropic key.                                 |
| `ELEVENLABS_API_KEY`         | **Not used yet.** Text to speech through the ElevenLabs TtsProvider, from Phase 3.                                                                      |
| `OPENAI_API_KEY`             | **Not used yet.** Whisper speech to text only, from Phase 3.                                                                                            |

Secrets never enter git. In the app they live in the OS keychain through Electron `safeStorage`, written
as ciphertext to `secrets.json`; if the OS has no encryption backend the store refuses to write at all
rather than leaving a key readable on disk.

## How to add a host

A host is anything that can show a pet and capture what the user is looking at: the Electron app, the
Chrome extension, or something new. Adding one never touches the core.

1. Implement the **Perception** contract: answer `perception.capture` for selection, active window,
   clipboard, page text, and (from Phase 2) screenshot, returning a `ContextSnapshotPatch` from
   `packages/protocol`. Advertise only what you can actually read, in the `capabilities` array of
   `hello`.
2. Implement the **Presentation** contract: render pets, stream reply deltas, and show approval cards.
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

- **BrainProvider** for the AI engine. Existing: `openrouter` and `nebius` (two presets of the
  OpenAI-compatible `OpenAiCompatibleProvider`), `anthropic`, and `fake` (tests and demos); `ollama`
  is planned after Phase 5. Another OpenAI-format service needs no code — see
  [Choosing a pet's brain](#choosing-a-pets-brain); a new named preset is one entry in
  `packages/core/src/providers/presets.ts`.
- **SttProvider** for speech to text and **TtsProvider** for text to speech arrive in Phase 3; neither
  interface exists yet.

Implement `BrainProvider`, register it in `packages/core/src/providers/registry.ts`, give it a
`SECRET_KEYS` entry if it takes a key, and select it per pet in settings. Do not widen the interface for a provider that is not being built.

## Conventions

- **Test first.** Write the failing test, make it pass, refactor. No production code without a test that
  motivated it.
- **Never overengineer.** Build what the current task needs. Interfaces exist only where a second
  implementation is already planned.
- **Core stays pure.** `packages/core` and `packages/protocol` must not import `electron`, `react`, or
  browser globals. An ESLint `no-restricted-imports` rule enforces it.
- **Docs are part of done.** Update `README.md`, `docs/architecture.md`, and the relevant
  `docs/acceptance/phase-N.md` with every change.
- **Commits** use Conventional Commits, for example `feat(core): add PromptAssembler`.
- **Diagrams** are Mermaid with a black and white theme only.

## Known gaps

What is still standing, recorded here so nobody rediscovers it.

- **No Tailwind build in the desktop renderer.** `@tagalong/ui` is written against Tailwind utility
  classes, but the desktop renderer has no Tailwind toolchain, so those class names resolve to nothing.
  `apps/desktop/src/renderer/src/app.css` hand-writes the structural rules the utilities would have
  supplied — enough for a usable panel, but the components are unstyled beyond that until the build
  gains Tailwind.
- **No approval cards in the side panel yet.** They arrive with Phase 5 (Hands), in `packages/ui`,
  and the side panel will show them without extension changes — its bridge already relays every
  `turn.*` event and every engine call.
- **No Fast Refresh in dev.** `@vitejs/plugin-react` 6.x imports `vite/internal`, which only exists in
  Vite 8, while electron-vite 5 pins Vite 7. The renderer config therefore drops the plugin and uses
  Vite's own esbuild transform (`esbuild: { jsx: 'automatic' }`) for JSX. Everything builds and runs;
  the only loss is Fast Refresh during `pnpm dev:desktop`.

- **A watch covers a whole display or a rectangle the pet names.** The phase plan also offers the
  focused window as a region and drag-to-select; the window inventory carries no window bounds, so
  the focused window is used for the text-only check and to pick the display instead, and
  drag-to-select is deferred.
- **The installer is unsigned and uses Electron's default icon.** SmartScreen warns on first run.
- **Windows only.** The macOS and Linux installers are configured, but there is no platform adapter for
  either, so the app stops at launch there.
- **No microphone or speaker step in the setup wizard.** Voice (Phase 3) is not in this build.
- **Watch alerts are shown, not spoken.** Phase 3 (Voice) is not built; when it lands, `watch.fired`
  should be spoken in the pet's voice.

## Delivery phases

Each phase has its own Notion page with step-by-step instructions and an acceptance script. Work them in
order; each one ends with something testable end to end.

0. **Setup** — monorepo, CI, conventions, keys. _(complete)_
1. **Foundation** — protocol, core engine, text-only ask with one pet on Windows. _(complete)_
2. **Sight** — screenshots, vision, exclusions, capture indicator. _(complete)_
3. **Voice** — push to talk, streaming speech, interruption.
   3B. **Awareness** — rolling memory, `recall_screen` and `what_changed`, watch mode. _(built; spoken
   watch alerts wait for Phase 3)_
4. **Crew** — multiple pets, memory, handoff, consult, roundtable. _(built)_
5. **Hands** — MCP client, allowlists, approval cards, action log.
6. **Browser Host** — Chrome extension on the same engine. _(built; runs fifth, after 2B)_
7. **Polish and Cross-platform** — macOS, Linux, onboarding, packaging, cost dashboard. _(setup
   wizard and Windows installer built; macOS, Linux, complete settings, cost dashboard and the
   release checklist are not in this build)_
