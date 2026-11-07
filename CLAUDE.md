# Tagalong

A desktop screen companion for Windows: Scout sits on your screen and helps with what you are working on.
Product intent: bodies/PRODUCT.md. Visual design: bodies/DESIGN.md (both under bodies/ so the impeccable design skill finds them from every UI app). Engineering reference: docs/ (start at docs/README.md).

## Architecture

The brain is Python; the TypeScript apps are bodies.

- A Python brain (brain/) talks to TypeScript bodies (bodies/desktop, bodies/browser) over the contract in protocol/README.md.
- Bodies talk only to the brain. Single user: no TLS, pairing or multi-user work yet.
- The plan, decisions and build order live in Notion (links in CLAUDE.local.md). Read it before working on the brain.
- Brain work goes into the Python brain.
- When commands or layout change, update this file in the same PR.

## Commands

- Setup: pnpm install (Node >= 22, pnpm 10)
- Test: pnpm test (vitest, all packages); pnpm --filter @tagalong/desktop test:e2e for the Electron Playwright suites (they run on a fake brain, no real brain needed)
- Check: pnpm typecheck && pnpm lint && pnpm format:check
- Brain (Python 3.12 or 3.13): cd brain && uv sync; uv run pytest; uv run ruff check; uv run ruff format --check; uv run brain (starts the websocket server)
- Run: pnpm dev:desktop (builds contract, ui and the browser add-on first; the desktop starts the brain if none is running and stops only that one on quit; or run `cd brain && uv run brain` yourself); the desktop dials the brain at TAGALONG_BRAIN_ADDR (default 127.0.0.1:47321) and retries every 2 s
- Experts: Scout installs them on demand from the registry (nothing to install by hand); each runs on the user's own login, not the API key; TAGALONG_EXPERT_CMD adds one custom expert
- Setup from a terminal (no screen): cd brain && uv run tagalong doctor (also key set, install <expert>, login <expert>, apps add <app>; never needs a running brain)
- Package: pnpm package:win

## Layout

- protocol/README.md: contract v1 between the Python brain and the bodies (source of truth)
- protocol/examples: sample frames shared by the TypeScript and Python tests
- protocol/ts: `@tagalong/contract`, zod schemas for contract v1
- brain/: the Python brain (uv project; `src/brain/protocol.py` holds the contract v1 pydantic types; `main.py` starts the websocket server (`server.py`), `config.py` reads its settings from the environment and `.env`, `bodies.py` tracks connected bodies and their outboxes, `sessions.py` the one conversation, `memory.py` the `Memory` object over `tagalong.db` (it masks memory text on save), `store/` the only code that runs SQL (`db.py` opens `tagalong.db` and runs the numbered migrations in `store/migrations/`, `search.py` the FTS5 helpers, `conversation.py`, `memory.py`, `connections.py` and `outputs.py` the SQL of chat, memory items and layers, apps and tool outputs, `work.py` the work tables, their state machine and the sweep of finished work, `rules.py` tool modes, preferences and offers), `tools.py` the brain's own tools, `toolbox.py` the tool gate, `apps.py`, `app_oauth.py` and `app_tools.py` connected apps (MCP), their browser sign-in and their tools, `asks.py` permission asks, `approvals.py` the log of how each ask ended, `experts.py` expert adapters over ACP, one process per expert shared by sessions, `expert_apps.py` the loopback MCP bridge by which an expert reaches chosen apps through the toolbox, `jobs.py` the hand-offs to Claude Code, `job_records.py` jobs and their parts as goal and expert_call work rows, `job_activity.py` a job's steps as a masked, capped log, `reading.py` and `reading_tools.py` how the body reads the screen, kept for Home and Scout, `outputs.py` a long tool result as a capped preview with the rest stored masked for `read_output`, `side_check.py` Scout approving an ask under a preference, `offers.py` Scout offering a preference, `guardrails.py` the budget (searches included), `retry.py` which failures and tools may be tried again, `web_tools.py` Scout's web search and fetch (Anthropic's server tools), `guards.py` the guard runner, `masking.py` the Masker, save guard and log filter (secrets become `[secret]` before they are saved), `builtin_guards.py` the built-in guards, `events.py` and `scheduler.py` the event kinds and the wakes (Scout speaks first), `timers.py` Scout's timers, `loops/` loops (things left open): shape, store, the mail poll and the surfacing in `service.py`, `tools.py` Scout's loop tools (Show, Done, Later, draft), `triggers/` the pure rules (context, due, urgent, quiet, stale, snooze), `home_tools.py` Home's switch, Held list, forget and wipe tools, `reader.py` the mail reader with its pre-filter and own allowance, `source.py` and `sources/gmail.py` the mail source protocol and its Gmail adapter, `questions.py` an expert's question to Scout first, `voice/` the mic and speech seam (`VoiceHooks`), the brain's ears (Silero, Moonshine, Smart Turn behind protocols; `service.py` is the `VoiceHooks` implementation, one listening session at a time, `load.py` the only importer of the real models) and mouth (`mouth.py` sends a spoken reply as `speech` frames, `speakable.py` the sentence rules, `kokoro.py` the Kokoro adapter), `mind/` Scout's soul, `events.md` (per-kind notes), `approvals.md` (side-check and offer wording), `capabilities.py` (the capability picture in the prompt), prompt, thinking loop (`turn.py`: history stays valid even when a turn is cancelled) and `resume.py` (rebuilds history from the saved chat); `setup/` Scout setting things up: `paths.py` (locations under the home folder), `facts.py` (`inspect` the machine), `net.py` and `registry.py` (ACP and MCP registry read with a cache), `node_runtime.py` and `archive.py` (Tagalong's own checked Node, safe extract), `store.py` (installed experts), `install.py` and `expert_tools.py` (`install_expert`, `login_expert`), `login.py`, `terminal.py` and `env.py` (expert login, the terminal-window seam, the per-expert env strip), `tools.py` (`inspect_machine`, `find_experts`, `find_apps`, the `hand_off` refusal facts), `apps.py` (`install_app`: a registry app saved like `add_app`), `home_tools.py` (Home's setup tools for the Connections page and the tour); `cli.py` the `tagalong` command (doctor, key set, install, apps add, login) over `setup/`; see docs/brain.md)
- bodies/ui: shared React UI (bubble, dock pet, Home, settings, voice; `src/controls/` the shared controls (toggle, three-way, select, slider, money field, keycap, button, level meter, mic test) and `CONTROLS_CSS`, `src/key/` the Anthropic key field and daily limit, `chat-styles.ts` the companion chat's look, `scout-mark.tsx` Scout's still mark, `src/walkthrough/` the first-run tour, `src/home/reading-rows.tsx` the "How Scout reads your screen" group in Where things run, `src/jobs-kinds.ts` the everyday jobs and the app each needs)
- bodies/desktop: Electron body (dials the Python brain; `src/main/tools/files.ts` the file tools, confined to the person's chosen folders; `src/main/ipc/ask-scout.ts` Home asking Scout as the person, `src/main/windows/walkthrough.ts`, `walkthrough-gate.ts` and `ipc/key.ts`, `ipc/walkthrough.ts` the first-run tour window, its launch gate and the key calls)
- bodies/browser: browser body (Chromium MV3; listens by voice from the popup: src/voice/, an offscreen mic page in src/offscreen/, the mic permission page src/permission/mic.*)
- docs/: one doc per subsystem; docs/development.md has the full layout and how-tos; docs/storage.md maps every store by kind

## Conventions

- The contract package stays pure: protocol/ts depends on zod only and never imports electron, react or browser globals (ESLint enforces). Shared React-free shapes live in bodies/ui/src/shapes (`@tagalong/ui/shapes`).
- No computer control: no mouse or keyboard automation anywhere. The one exception is the desktop's Ctrl+C selection copy (bodies/desktop/src/main/platform/selection.ts), scoped to reading the selection and restoring the clipboard. The desktop file tools (bodies/desktop/src/main/tools/files.ts) are file access inside folders the person chose, not computer control.
- Tests run on fakes, never real providers: the fake brain in bodies/desktop/e2e/fixtures and fake clients in the Python tests. A real API call costs the user money; only make one when the user asks in that session.
- Secrets never enter git: keys live in the environment or `<TAGALONG_HOME>/.env`. Every variable the code reads appears in .env.example.
- Every file opens with a 2-6 line header; comments explain why, not history.
- Conventional Commits, e.g. feat(desktop): ...
- Docs are part of done: README.md, the matching docs/ subsystem doc, and docs/testing/feature-test-guide.md. A contract change also updates protocol/README.md, protocol/examples, protocol/ts and brain/src/brain/protocol.py together.
- CI: branch protection on main requires build (Linux), brain (Linux) and e2e (Windows); docs-only PRs skip all three.
