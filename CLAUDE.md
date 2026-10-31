# Tagalong

A desktop screen companion for Windows: Scout sits on your screen and helps with what you are working on.
Product intent: PRODUCT.md. Visual design: DESIGN.md. Engineering reference: docs/ (start at docs/README.md).

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
- Brain: cd brain && uv sync; uv run pytest; uv run ruff check; uv run ruff format --check; uv run brain (starts the websocket server)
- Run: pnpm dev:desktop (the desktop starts the brain if none is running and stops only that one on quit; or run `cd brain && uv run brain` yourself); the desktop dials the brain at TAGALONG_BRAIN_ADDR (default 127.0.0.1:47321) and retries every 2 s
- Experts: npm install -g @agentclientprotocol/claude-agent-acp (Node 22+), and Claude Code logged in (it runs on the user's login, not the API key)
- Package: pnpm package:win

## Layout

- protocol/README.md: contract v1 between the Python brain and the bodies (source of truth)
- protocol/examples: sample frames shared by the TypeScript and Python tests
- protocol/ts: `@tagalong/contract`, zod schemas for contract v1
- brain/: the Python brain (uv project; `src/brain/protocol.py` holds the contract v1 pydantic types; `main.py` starts the websocket server (`server.py`), `config.py` reads its settings from the environment and `.env`, `bodies.py` tracks connected bodies and their outboxes, `sessions.py` the one conversation, `memory.py` the memory store, `tools.py` the brain's own tools, `toolbox.py` the tool gate, `apps.py`, `app_oauth.py` and `app_tools.py` connected apps (MCP), their browser sign-in and their tools, `asks.py` permission asks, `approvals.py` the log of how each ask ended, `experts.py` one Claude Code session over ACP, `jobs.py` the hand-offs to Claude Code, `side_check.py` Scout approving an ask under a preference, `offers.py` Scout offering a preference, `guardrails.py` the budget, `guards.py` the guard runner, `masking.py` the Masker, save guard and log filter (secrets become `[secret]` before they are saved), `builtin_guards.py` the built-in guards, `events.py` and `scheduler.py` the event kinds and the wakes (Scout speaks first), `timers.py` Scout's timers, `questions.py` an expert's question to Scout first, `mind/` Scout's soul, `events.md` (per-kind notes), `approvals.md` (side-check and offer wording), prompt, thinking loop (`turn.py`: history stays valid even when a turn is cancelled) and `resume.py` (rebuilds history from the saved chat); see docs/brain.md)
- bodies/ui: shared React UI (bubble, dock pet, Home, settings, voice)
- bodies/desktop: Electron body (dials the Python brain)
- bodies/browser: browser body (Chromium)
- docs/: one doc per subsystem; docs/development.md has the full layout and how-tos

## Conventions

- The contract package stays pure: protocol/ts depends on zod only and never imports electron, react or browser globals (ESLint enforces). Shared React-free shapes live in bodies/ui/src/shapes (`@tagalong/ui/shapes`).
- No computer control: no mouse or keyboard automation anywhere. The one exception is the desktop's Ctrl+C selection copy (bodies/desktop/src/main/platform/selection.ts), scoped to reading the selection and restoring the clipboard.
- Tests run on fakes, never real providers: the fake brain in bodies/desktop/e2e/fixtures and fake clients in the Python tests. A real API call costs the user money; only make one when the user asks in that session.
- Secrets never enter git: keys live in the environment or `<TAGALONG_HOME>/.env`. Every variable the code reads appears in .env.example.
- Every file opens with a 2-6 line header; comments explain why, not history.
- Conventional Commits, e.g. feat(desktop): ...
- Docs are part of done: README.md, the matching docs/ subsystem doc, and docs/testing/feature-test-guide.md. A contract change also updates protocol/README.md, protocol/examples, protocol/ts and brain/src/brain/protocol.py together.
- CI: branch protection on main requires build (Linux), brain (Linux) and e2e (Windows); docs-only PRs skip all three.
