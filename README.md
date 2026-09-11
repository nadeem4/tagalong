# Tagalong

Tagalong is a desktop screen companion: a crew of AI pets that tag along on your screen. They see what
you are looking at, answer in text or voice, remember context, talk to each other, and act on your
behalf through MCP tools you approve. They never take over your mouse or keyboard.

- Canonical plan, phase instructions, task board, and decisions:
  <https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc>
- Local design copy: [docs/specs/2026-09-11-tagalong-design.md](docs/specs/2026-09-11-tagalong-design.md)
- Architecture: [docs/architecture.md](docs/architecture.md)

**Status: Phase 0 (Setup) is complete. Phase 1 (Foundation) is next.**

## Repository layout

A pnpm workspace monorepo. One core engine, many thin hosts.

```text
tagalong/
  package.json              # pnpm workspace root (private)
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  .github/workflows/ci.yml
  docs/
    architecture.md
    specs/2026-09-11-tagalong-design.md
    acceptance/phase-0.md ... phase-7.md
  packages/
    protocol/
    core/
    ui/
  apps/
    desktop/
    extension/
```

| Package             | Responsibility                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Zod schemas for context snapshots, pets, and messages, plus the JSON-RPC method catalog. Depends only on zod.                                                         |
| `packages/core`     | The Tagalong Engine: pets, conversation loop, prompt assembly, memory, voice pipeline, inter-pet bus, MCP client, host protocol server, provider adapters. Pure Node. |
| `packages/ui`       | React components shared by hosts: avatar, chat panel, composer, context chip, approval card, crew view, settings panels.                                              |
| `apps/desktop`      | Electron host. Runs the engine in the main process, exposes the localhost socket, transparent overlay windows, hotkeys, tray, secret storage.                         |
| `apps/extension`    | Chrome MV3 host. Connects to the running engine, supplies exact page text and selection, renders pets in the side panel. Stub until Phase 6.                          |

## How to run

Prerequisites:

- Windows 11 (primary dev target; macOS and Linux arrive in Phase 7)
- Node.js 22 LTS (`node -v`)
- pnpm 9 or newer (`corepack enable` then `corepack prepare pnpm@latest --activate`)
- Git
- Python 3 and Visual Studio Build Tools with the **Desktop development with C++** workload —
  `better-sqlite3` compiles a native module for Electron

Commands, run from the repository root:

```bash
pnpm install       # install all workspace dependencies
pnpm lint          # ESLint across every package
pnpm typecheck     # TypeScript project references, no emit
pnpm test          # Vitest across every package
pnpm build         # build every package
pnpm dev:desktop   # run the Electron host in development
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in what the phase you are on needs.

| Variable                    | Used for                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | Claude API calls through the `anthropic` BrainProvider. Needed from Phase 1.            |
| `ELEVENLABS_API_KEY`        | Text to speech through the ElevenLabs TtsProvider. Needed from Phase 3.                 |
| `OPENAI_API_KEY`            | Whisper speech to text only. Needed from Phase 3.                                       |
| `TAGALONG_FAKE_PROVIDERS=1` | Forces the fake AI and voice providers, for tests and demos. No keys or network needed. |

Secrets never enter git. In development they come from the environment; in the packaged app they live in
the OS keychain through Electron `safeStorage`.

## How to add a host

A host is anything that can show a pet and capture what the user is looking at: the Electron app, the
Chrome extension, or something new. Adding one never touches the core.

1. Implement the **Perception** contract: answer capture requests for selection, active window,
   screenshot, clipboard, and page text, returning a `ContextSnapshot` from `packages/protocol`.
2. Implement the **Presentation** contract: render pets, stream reply deltas, play audio, and show
   approval cards.
3. Speak the JSON-RPC protocol over the localhost WebSocket the engine exposes
   (`ws://127.0.0.1:47321`), presenting the pairing token on connect. The method catalog and every
   payload schema live in `packages/protocol`.
4. Never import core internals. A host uses the protocol, and the engine's public API where it embeds
   the engine in process. `apps/extension` imports nothing from core at all; it speaks the protocol only.

## How to add a provider

Providers are the swappable edges of the engine. Each one is an interface in `packages/core` with more
than one planned implementation.

- **BrainProvider** for the AI engine. Existing: `anthropic` (default), `fake` (tests and demos);
  `ollama` and `openai-compatible` are planned after Phase 5.
- **SttProvider** for speech to text. Existing: Whisper through the OpenAI API.
- **TtsProvider** for text to speech. Existing: ElevenLabs streaming.

Implement the existing interface, register the provider, and select it per pet in settings. Do not widen
the interface for a provider that is not being built.

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

## Privacy

- Capture happens only when you ask, never continuously.
- A visible indicator shows every capture.
- An exclusion list blocks capture in password managers and other listed apps.
- Everything is stored locally in SQLite.
- Screenshots are not persisted by default.
- API keys live in the OS keychain through Electron safe storage.

## No computer control

Tagalong never automates the mouse or the keyboard. Pets do not click, type, or drive other
applications. Everything a pet does happens through MCP tools you configure, with a per-pet allowlist:
read-only tools run automatically, tools that write require a tap on an approval card, and every action
is logged. Mouse and keyboard automation is out of scope. If it ever arrives, it arrives as an MCP
server behind the same approval gate.

## Delivery phases

Each phase has its own Notion page with step-by-step instructions and an acceptance script. Work them in
order; each one ends with something testable end to end.

0. **Setup** — monorepo, CI, conventions, keys. _(complete)_
1. **Foundation** — protocol, core engine, text-only ask with one pet on Windows. _(next)_
2. **Sight** — screenshots, vision, exclusions, capture indicator.
3. **Voice** — push to talk, streaming speech, interruption.
4. **Crew** — multiple pets, memory, handoff, consult, roundtable.
5. **Hands** — MCP client, allowlists, approval cards, action log.
6. **Browser Host** — Chrome extension on the same engine.
7. **Polish and Cross-platform** — macOS, Linux, onboarding, packaging, cost dashboard.
