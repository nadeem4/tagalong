# Tagalong

A desktop screen companion for Windows: Scout sits on your screen and helps with what you are working on.
Product intent: bodies/PRODUCT.md. Visual design: bodies/DESIGN.md (both under bodies/ so the impeccable design skill finds them from every UI app). Engineering reference: docs/ (start at docs/README.md).

## Constraints

- Who uses it: the owner, one person on one Windows PC; public repo, launch to others later
- Scale: one user, one brain, a few bodies (desktop, Chrome, WhatsApp)
- Optimises for: low API spend, Scout feeling present and helpful, no tech debt (rewrite, never shim)
- Will not spend effort on: multi-user
- Not yet, planned later: macOS/Linux bodies, computer control; plans may leave seams, not features
- Real API calls only when the owner asks; tests run on fakes

## Check and release

Check command: pnpm typecheck && pnpm lint && pnpm format:check && cd brain && uv run ruff check && uv run ruff format --check

Before a push only the lines matching the changed files run (`scripts/check_pr.py` reads them; an unlisted path runs the Check command). Full test suites run in CI (ci.yml):

Check [brain/*, protocol/*]: cd brain && uv run ruff check && uv run ruff format --check && uv run pytest --testmon -q
Check [protocol/*, bodies/*]: pnpm typecheck && pnpm lint && pnpm format:check && pnpm exec vitest run --changed origin/main
Check [docs/*, *.md, .github/*, .githooks/*, scripts/*, .gitignore, .prettierignore]: none

Release targets: none (the Windows installer ships by pushing a v* tag; release.yml builds it)

## Architecture

The brain is Python; the TypeScript apps are bodies.

- A Python brain (brain/) talks to TypeScript bodies (bodies/desktop, bodies/browser, bodies/whatsapp) over the contract in protocol/README.md.
- Bodies talk only to the brain, each with a token in `hello` (local token file on this PC; opt-in encrypted listener for other devices, `TAGALONG_NETWORK=1`). Single user.
- Plans, the current slice and the feature queue live in `.plan/` (local, see `.plan/STATE.md`); Notion is the dashboard only.

## Commands

- Setup: pnpm install (Node >= 22, pnpm 10)
- Test: pnpm test (vitest, all packages); pnpm --filter @tagalong/desktop test:e2e for the Electron Playwright suites (they run on a fake brain, no real brain needed)
- Check: pnpm typecheck && pnpm lint && pnpm format:check
- Brain (Python 3.12 or 3.13): cd brain && uv sync; uv run pytest; uv run ruff check; uv run ruff format --check; uv run brain (starts the websocket server); uv run tagalong stop (ends the brain the desktop left running); uv run tagalong perf [--since 1h] (step timings and cancelled asks, read from brain.log)
- Run: pnpm dev:desktop (builds contract, ui and the browser add-on first; the desktop starts the brain detached if none is running (output in <TAGALONG_HOME>/brain.log) and leaves it running on quit; or run `cd brain && uv run brain` yourself); the desktop dials the brain at TAGALONG_BRAIN_ADDR (default 127.0.0.1:47321) and retries every 2 s
- Experts: Scout installs them on demand from the registry (nothing to install by hand); each runs on the user's own login, not the API key; TAGALONG_EXPERT_CMD adds one custom expert
- Setup from a terminal (no screen): cd brain && uv run tagalong doctor (also stop, key set, install <expert>, login <expert>, apps add <app>, pair [--kind]; never needs a running brain)
- Package: pnpm package:win
- WhatsApp bridge: pnpm --filter @tagalong/whatsapp build (one file, dist/index.js) and test; `pnpm dev:desktop` builds it

## Layout

- protocol/: the contract between the brain and the bodies (README.md is the source of truth, examples/ shared by both test suites, ts/ the zod package `@tagalong/contract`)
- brain/: the Python brain (uv project); start at `src/brain/main.py` and `server.py`; module map in docs/brain/README.md
- bodies/ui: shared React UI (Home, tour, settings, voice, bubble); `src/shapes` holds React-free shapes
- bodies/mascot: `@tagalong/mascot`, the WebGL mascot engine (docs/bodies/mascot.md)
- bodies/desktop: Electron body; main process in `src/main/` (brain link, IPC, windows, tools)
- bodies/browser: Chromium MV3 browser body (popup voice, offscreen mic)
- bodies/whatsapp: WhatsApp body, bundled to one `dist/index.js` the brain runs
- docs/: one doc per subsystem in brain/, senses/, bodies/, data/; docs/layout.md has every file
- scripts/check_pr.py and .githooks/pre-push: the pre-push check
- When commands or folders change, update this file (and docs/layout.md) in the same PR.

## Conventions

- The contract package stays pure: protocol/ts depends on zod only and never imports electron, react or browser globals (ESLint enforces). Shared React-free shapes live in bodies/ui/src/shapes (`@tagalong/ui/shapes`).
- No computer control: no mouse or keyboard automation anywhere. The one exception is the desktop's Ctrl+C selection copy (bodies/desktop/src/main/platform/selection.ts), scoped to reading the selection and restoring the clipboard. The desktop file tools (bodies/desktop/src/main/tools/files.ts) are file access inside folders the person chose, not computer control.
- Tests run on fakes, never real providers: the fake brain in bodies/desktop/e2e/fixtures and fake clients in the Python tests. A real API call costs the user money; only make one when the user asks in that session.
- Secrets never enter git: keys live in the environment or `<TAGALONG_HOME>/.env`. Every variable the code reads appears in .env.example.
- Every file opens with a 2-6 line header; comments explain why, not history.
- Conventional Commits, e.g. feat(desktop): ...
- Docs are part of done: README.md, the matching docs/ subsystem doc, and docs/testing/feature-test-guide.md. A contract change also updates protocol/README.md, protocol/examples, protocol/ts and brain/src/brain/protocol.py together.
- A change to a shared signature or a contract field runs the full suites of every package that fakes it (brain pytest, each body's vitest) before review; targeted runs miss fakes in untouched test files.
- CI: branch protection on main requires build (Linux), brain (Linux) and e2e (Windows); docs-only PRs skip all three.
