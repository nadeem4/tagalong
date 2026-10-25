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
- Test: pnpm test (vitest, all packages); pnpm test:e2e for the Electron Playwright suites
- Check: pnpm typecheck && pnpm lint && pnpm format:check
- Brain: cd brain && uv sync; uv run pytest; uv run ruff check; uv run ruff format --check; uv run brain (starts the websocket server)
- Run: pnpm dev:desktop
- Package: pnpm package:win

## Layout

- protocol/README.md: contract v1 between the Python brain and the bodies (source of truth for the rewrite)
- protocol/examples: sample frames shared by the TypeScript and Python tests
- protocol/ts: `@tagalong/contract`, zod schemas for contract v1
- brain/: the Python brain (uv project; `src/brain/protocol.py` holds the contract v1 pydantic types; `server.py` is the websocket server, `sessions.py` the one conversation, `guardrails.py` the budget, `mind/` Scout's soul, prompt and thinking loop; see docs/brain.md)
- packages/protocol: wire types and the JSON-RPC method catalog shared by brain and bodies
- packages/core: the current brain (Scout's mind, sight, memory, tools, experts, routines, providers, ws server)
- bodies/ui: shared React UI (bubble, dock pet, Home, settings, voice)
- bodies/desktop: Electron body
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
