---
name: tagalong-phase
description: Use when building any slice of the Tagalong repo, the Python brain or the TypeScript bodies - before writing code, committing, or opening a PR.
---

# Tagalong slice execution

One slice = one PR = one session. CLAUDE.md is the authority for commands and layout; this
skill is the order of work and the rules that outrank convenience.

## Start

1. Read the hub and Plan named in CLAUDE.local.md (private, not committed). The plan says WHAT;
   this skill and CLAUDE.md say HOW.
2. The slice's tracker row has a `Next:` line. Start there.
3. All Notion reads and writes go through the `notion-tracker` agent. Set the row to
   `In progress` first, and when you stop (even mid-slice) write the next step as one `Next:`
   line on the row.

## Per task

1. Write the failing test first. No production code without a test that motivated it.
   - TypeScript: vitest (`pnpm test`).
   - Python: `cd brain && uv run pytest`.
2. Make it pass, then refactor.
3. Update the docs in the same change: `README.md`, the matching subsystem doc under `docs/`
   (index: `docs/README.md`; layout and how-tos: `docs/development.md`), and
   `docs/testing/feature-test-guide.md`. A contract change also updates `protocol/README.md`,
   `protocol/examples` and `protocol/ts` (and the Python types in `brain/src/brain/protocol.py`).
4. Commit with a Conventional Commit scoped to the package (`feat(brain): ...`).

## Before the PR

Run all of these and fix what they report:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
cd brain && uv run pytest && uv run ruff check && uv run ruff format --check
```

The Electron e2e suites (`pnpm --filter @tagalong/desktop test:e2e`) run on request or when the
slice touches the desktop. CI requires build (Linux), e2e (Windows) and brain; docs-only PRs skip
the first two.

Keep the PR to 500-1,000 changed lines, lockfiles and generated files excluded. Go bigger only
when it cannot be split, and say why under "Why" in the PR.

- Never commit to `main`. Branch, push, open a PR with `gh pr create`.
- Title: `type(scope): what changes, in plain words (slice id)`, lowercase, under 72 characters,
  no trailing period.
- Body: follow `~/.claude/templates/pull_request.md` (the repo has no template). No Notion links.
- A red PR is never merged. Merge with `gh pr merge --squash --delete-branch`.
- Then update the tracker row (status, PR link, `Next:` line) through `notion-tracker`.

## Invariants that outrank convenience

- **The contract package is pure.** `protocol/ts` depends on zod only and never imports
  `electron`, `react` or DOM globals. ESLint enforces it: fix the import, never the rule.
- **No computer control.** No mouse or keyboard automation anywhere in the repo. The one
  exception is the Ctrl+C selection trick in the desktop, scoped to reading the selection and
  restoring the clipboard.
- **Tests run on fakes, never real providers.** Use the fake brain in `bodies/desktop/e2e/fixtures`
  and fake clients in the Python tests. A real API call costs the user money. Steps that truly
  need a real provider go to the user to run; only use one when the user asks in that session.
- **Never overengineer.** Build what the current task needs. An interface exists only where the
  plan names a second implementation.
- **Secrets never enter git.** Keys live in the environment or the OS keychain, never in files
  that are committed. Every variable the code reads appears in `.env.example`.
- **Diagrams are Mermaid, black and white only.**
- **No AI attribution anywhere.** Nothing credits an AI as author or contributor: not in commits,
  trailers, PR titles or bodies, docs, code comments or tracker updates. Naming Anthropic as a
  vendor (the API, model ids, the Claude Code sign-in experts use) is fine; the test is
  authorship.

## Stop and re-read the plan if you are about to

- import `electron` or `react` into `protocol/ts` or `@tagalong/ui/shapes`
- write production code with no failing test behind it
- make a real API call to check your own work
- change the contract without updating `protocol/README.md`, `protocol/examples` and `protocol/ts`
- write a Notion link into a PR, or any AI attribution anywhere
