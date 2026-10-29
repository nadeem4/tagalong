# Tagalong

A desktop screen companion for Windows: Scout sits on your screen and helps with what you are working on.
Product intent: PRODUCT.md. Visual design: DESIGN.md. Engineering reference: docs/ (start at docs/README.md).

## Direction (read first)

The brain is being rewritten in Python; the TypeScript apps stay as bodies.

- Today: everything in this repo is TypeScript. packages/core is the current brain.
- Target: a Python brain (runs on any machine) talks to TypeScript bodies (bodies/desktop, apps/extension) over the contract in protocol/README.md.
- Bodies talk only to the brain. Single user: no TLS, pairing or multi-user work yet.
- The plan, decisions and build order live in Notion (links in CLAUDE.local.md). Read it before working on the brain.
- Don't add new features to packages/core unless the task asks for it; new brain work goes into the Python brain.
- When the rewrite changes commands or layout, update this file in the same PR.

## Commands

- Setup: pnpm install (Node >= 22, pnpm 10)
- Test: pnpm test (vitest, all packages); pnpm --filter @tagalong/desktop test:e2e for the Electron Playwright suites (they run on a fake brain, no real brain needed)
- Check: pnpm typecheck && pnpm lint && pnpm format:check
- Brain: cd brain && uv sync; uv run pytest; uv run ruff check; uv run ruff format --check; uv run brain (starts the websocket server)
- Run: cd brain && uv run brain (leave it running), then pnpm dev:desktop; the desktop dials the brain at TAGALONG_BRAIN_ADDR (default 127.0.0.1:47321) and retries every 2 s
- Experts: npm install -g @agentclientprotocol/claude-agent-acp (Node 22+), and Claude Code logged in (it runs on the user's login, not the API key)
- Package: pnpm package:win

## Layout

- protocol/README.md: contract v1 between the Python brain and the bodies (source of truth for the rewrite)
- protocol/examples: sample frames shared by the TypeScript and Python tests
- protocol/ts: `@tagalong/contract`, zod schemas for contract v1
- brain/: the Python brain (uv project; `src/brain/protocol.py` holds the contract v1 pydantic types; `server.py` is the websocket server, `sessions.py` the one conversation, `memory.py` the memory store, `tools.py` the brain's own tools, `toolbox.py` the tool gate, `apps.py`, `app_oauth.py` and `app_tools.py` connected apps (MCP), their browser sign-in and their tools, `asks.py` permission asks, `side_check.py` Scout approving an ask under a preference, `offers.py` Scout offering a preference, `guardrails.py` the budget, `events.py` and `scheduler.py` the event kinds and the wakes (Scout speaks first), `timers.py` Scout's timers, `questions.py` an expert's question to Scout first, `mind/` Scout's soul, `events.md` (per-kind notes), `approvals.md` (side-check and offer wording), prompt, thinking loop and `resume.py` (rebuilds history from the saved chat); see docs/brain.md)
- packages/protocol: wire types and the JSON-RPC method catalog shared by brain and bodies
- packages/core: the old brain (Scout's mind, sight, memory, tools, experts, routines, providers, ws server); the desktop no longer boots it, and it will be deleted
- bodies/ui: shared React UI (bubble, dock pet, Home, settings, voice)
- bodies/desktop: Electron body (dials the Python brain; no longer boots packages/core)
- apps/extension: Chrome extension body
- docs/: one doc per subsystem; docs/development.md has the full layout and how-tos

## Conventions

- Core stays pure: packages/core and packages/protocol never import electron, react or browser globals (ESLint enforces).
- Tools go through tools/registry, never imported from tools/builtin/* directly (ESLint enforces). Use the tagalong-add-tool skill.
- Use the tagalong-phase skill when building a phase or task.
- Every file opens with a 2-6 line header; comments explain why, not history.
- Conventional Commits, e.g. feat(core): ...
- Docs are part of done: README.md, the matching docs/ subsystem doc, and docs/testing/feature-test-guide.md.
- CI: branch protection on main requires build (Linux) and e2e (Windows); docs-only PRs skip both.
