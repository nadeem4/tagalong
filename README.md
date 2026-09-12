# Tagalong

Tagalong is a desktop screen companion: a crew of AI pets that tag along on your screen. They see what
you are looking at, answer in text or voice, remember context, talk to each other, and act on your
behalf through MCP tools you approve. They never take over your mouse or keyboard.

- Canonical plan, phase instructions, task board, and decisions:
  <https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc>
- Local design copy: [docs/specs/2026-09-11-tagalong-design.md](docs/specs/2026-09-11-tagalong-design.md)
- Architecture: [docs/architecture.md](docs/architecture.md)

**Status: Phase 0 (Setup) and Phase 1 (Foundation) are complete. Phase 2 (Sight) is next.**

Phase 1 shipped the whole text path end to end on Windows: the protocol package, the engine with
SQLite-backed conversations, the Anthropic and fake brain providers, the loopback JSON-RPC server with
pairing, the shared React components, and the Electron host with a tray, a global hotkey, a draggable
avatar, a chat panel, and a settings window.

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
      context.ts                    # ContextSnapshot, ContextSnapshotPatch, PerceptionTarget
      pet.ts                        # Pet, ReplyStyle
      message.ts                    # Conversation, Message, MessageContent
      rpc.ts                        # JSON-RPC envelopes and error codes
      settings.ts                   # Settings, SettingsPatch, SETTINGS_DEFAULTS
      methods.ts                    # the method and notification catalog
    core/src/
      index.ts                      # the public facade hosts import
      engine.ts                     # Engine.boot: wires the parts together and listens
      conversation/                 # ConversationRunner, prompt-assembler
      memory/                       # db.ts (numbered migrations), store.ts (ConversationStore)
      pets/registry.ts              # PetRegistry, the default pet Scout
      providers/                    # brain.ts, anthropic.ts, fake.ts, registry.ts, errors.ts
      server/                       # ws-server.ts (EngineServer), pairing.ts
      settings/settings.ts          # SettingsStore, SecretStore, InMemorySecretStore
    ui/src/
      index.ts, host-bridge.ts      # HostBridge contract and its React context
      pet-avatar.tsx, message-list.tsx, composer.tsx, context-chip.tsx, chat-panel.tsx
      test-support/fake-host-bridge.ts
  apps/
    desktop/
      electron.vite.config.ts       # main / preload / renderer builds
      playwright.config.ts
      scripts/ensure-electron.mjs   # fetches the Electron binary
      e2e/smoke.spec.ts
      src/main/                     # index.ts, engine-host.ts, engine-client.ts, context.ts,
                                    # hotkeys.ts, secret-store.ts, tray-icon.ts, platform/, windows/
      src/preload/index.ts          # exposes window.tagalong and window.tagalongHost
      src/renderer/                 # avatar/panel/settings HTML, src/*.tsx, app.css
      src/shared/ipc.ts             # IPC channel names and the host-only API type
    extension/src/service-worker.ts # Chrome MV3 stub until Phase 6
```

| Package             | Responsibility                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Zod schemas for context snapshots, pets, messages, settings, and JSON-RPC, plus the method catalog. Depends only on zod.                                                                                          |
| `packages/core`     | The Tagalong Engine: pets, conversation runner, prompt assembly, SQLite memory, host protocol server, pairing, provider adapters. Pure Node. Voice, the inter-pet bus, and the MCP client arrive in later phases. |
| `packages/ui`       | React components shared by hosts: `PetAvatar`, `MessageList`, `Composer`, `ContextChip`, `ChatPanel`, and the `HostBridge` context.                                                                               |
| `apps/desktop`      | Electron host. Runs the engine in the main process, dials it over the loopback socket, and owns the avatar, panel, settings window, tray, hotkey, and secret storage.                                             |
| `apps/extension`    | Chrome MV3 host. Connects to the running engine and speaks the protocol only. Stub until Phase 6.                                                                                                                 |

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
```

Inside `apps/desktop`:

```bash
pnpm build            # ensure-electron, then electron-vite build into dist/
pnpm start            # ensure-electron, then electron-vite preview against the built output
pnpm test:e2e         # ensure-electron, electron-vite build, then the Playwright smoke suite
pnpm ensure-electron  # fetch the Electron binary on its own
```

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

Two things are worth knowing before the first run.

**`ensure-electron`.** Electron 44.3.0 publishes no npm install script, so `pnpm install` unpacks the
package without ever downloading the platform binary, and the first launch dies with an error that
reads like a broken machine. `apps/desktop/scripts/ensure-electron.mjs` runs the Electron package's own
`install.js` when `dist/` is missing, and it is wired into the `dev`, `build`, and `start` scripts — so
you normally never call it yourself.

**`TAGALONG_FAKE_PROVIDERS=1`.** With this set, `createProvider` returns the scripted
`FakeBrainProvider` whatever settings say: no API key, no network, and a deterministic word-by-word
stream. It is how the Playwright smoke suite runs, and the easiest way to see the app work before you
have a key. Without it, the engine needs an Anthropic key from the OS keychain; if none is stored the
engine refuses to boot, and the app opens its settings window and says so instead of quitting.

Once running: the pet sits on screen as a small always-on-top window, `Ctrl+Shift+Space` captures the
selection and the active window and opens the chat panel beside it, Escape or focus loss hides the
panel (unless a turn is still streaming), and the tray menu shows or hides the pets, opens settings,
and quits.

### The pairing token

On boot the engine writes a 32-byte hex token to `pairing.token` in its data dir, alongside
`tagalong.db`, `settings.json`, and `secrets.json`. On Windows that directory is
`%APPDATA%\@tagalong\desktop`. The token is stable across restarts, so a host that has already paired
does not have to pair again.

Every host must present that token in its `hello` call. A connection that sends anything else gets
RPC error `-32000` and the socket is closed; a connection that calls any other method before `hello`
gets the same error.

The token exists because **loopback is not a permission boundary**. Any process running as the user
can open a socket to `127.0.0.1:47321` — binding to loopback only keeps other machines out, not other
programs on this one. Without the token, any local program could drive the user's pets, read their
conversations, and spend their API budget. Comparison is constant-time, because a plain `===` leaks
the length of the shared prefix through timing.

## Environment variables

`.env.example` is a **reference list of the variables the project will use**, not a file the app loads.
Nothing reads `.env.local` today: there is no dotenv dependency, and no code in `packages/` or `apps/`
opens a `.env` file. Copying it therefore changes nothing at runtime.

The only environment variable read today is `TAGALONG_FAKE_PROVIDERS`, read straight from `process.env`
in `packages/core/src/providers/registry.ts`. **Set it in the shell you launch from**, as shown above.

| Variable                    | Status today                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAGALONG_FAKE_PROVIDERS=1` | **Read.** Forces the fake brain provider, for tests and demos. No keys or network needed. Must be set in the shell environment.                         |
| `ANTHROPIC_API_KEY`         | **Not read.** The key for the `anthropic` BrainProvider is entered in Settings and stored via Electron `safeStorage`, never taken from the environment. |
| `ELEVENLABS_API_KEY`        | **Not used yet.** Text to speech through the ElevenLabs TtsProvider, from Phase 3.                                                                      |
| `OPENAI_API_KEY`            | **Not used yet.** Whisper speech to text only, from Phase 3.                                                                                            |

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

- **BrainProvider** for the AI engine. Existing: `anthropic` (default), `fake` (tests and demos);
  `ollama` and `openai-compatible` are planned after Phase 5.
- **SttProvider** for speech to text and **TtsProvider** for text to speech arrive in Phase 3; neither
  interface exists yet.

Implement `BrainProvider`, register it in `packages/core/src/providers/registry.ts`, and select it per
pet in settings. Do not widen the interface for a provider that is not being built.

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

Two things Phase 1 left standing, both recorded here so nobody rediscovers them.

- **No Tailwind build in the desktop renderer.** `@tagalong/ui` is written against Tailwind utility
  classes, but the desktop renderer has no Tailwind toolchain, so those class names resolve to nothing.
  `apps/desktop/src/renderer/src/app.css` hand-writes the structural rules the utilities would have
  supplied — enough for a usable panel, but the components are unstyled beyond that until the build
  gains Tailwind.
- **No Fast Refresh in dev.** `@vitejs/plugin-react` 6.x imports `vite/internal`, which only exists in
  Vite 8, while electron-vite 5 pins Vite 7. The renderer config therefore drops the plugin and uses
  Vite's own esbuild transform (`esbuild: { jsx: 'automatic' }`) for JSX. Everything builds and runs;
  the only loss is Fast Refresh during `pnpm dev:desktop`.

## Privacy

- Capture happens only when you ask, never continuously.
- A visible indicator shows every capture (Phase 2).
- An exclusion list blocks capture in password managers and other listed apps (Phase 2).
- Everything is stored locally in SQLite.
- Screenshots are not persisted by default.
- API keys live in the OS keychain through Electron safe storage.

## No computer control

Tagalong never automates the mouse or the keyboard. Pets do not click, type, or drive other
applications — the system prompt says so explicitly, and forbids claiming otherwise. Everything a pet
does happens through MCP tools you configure, with a per-pet allowlist: read-only tools run
automatically, tools that write require a tap on an approval card, and every action is logged. Mouse and
keyboard automation is out of scope. If it ever arrives, it arrives as an MCP server behind the same
approval gate.

The one keyboard event in the repo is the desktop host's Ctrl+C selection trick, scoped to reading the
current selection and restoring the clipboard afterwards.

## Delivery phases

Each phase has its own Notion page with step-by-step instructions and an acceptance script. Work them in
order; each one ends with something testable end to end.

0. **Setup** — monorepo, CI, conventions, keys. _(complete)_
1. **Foundation** — protocol, core engine, text-only ask with one pet on Windows. _(complete)_
2. **Sight** — screenshots, vision, exclusions, capture indicator. _(next)_
3. **Voice** — push to talk, streaming speech, interruption.
4. **Crew** — multiple pets, memory, handoff, consult, roundtable.
5. **Hands** — MCP client, allowlists, approval cards, action log.
6. **Browser Host** — Chrome extension on the same engine.
7. **Polish and Cross-platform** — macOS, Linux, onboarding, packaging, cost dashboard.
