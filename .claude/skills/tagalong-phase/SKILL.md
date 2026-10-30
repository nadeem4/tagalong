---
name: tagalong-phase
description: Use when building any phase or task of the Tagalong project in this repo - before scaffolding packages, writing core/protocol/ui/desktop/extension code, committing, or marking a Notion task Done.
---

# Tagalong Phase Execution

## Overview

Tagalong is built phase by phase (0-7) from a canonical Notion plan. This skill is the
contract for how a phase gets executed so any agent picks up where the last one stopped.

**Core principle: the Notion task board is the source of truth for WHAT; this skill is the
source of truth for HOW.**

## Canonical sources

| Thing                                                   | Where                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project home, architecture, phase index                 | https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc                                                                                            |
| Task board (74 tasks, `Phase` + `Order` + `Acceptance`) | Notion database `Tagalong Tasks` (`collection://77eeaf1d-3ff5-4681-a3da-798819627121`)                                                               |
| Decision log                                            | Notion database `Tagalong Decisions` (`collection://47551ad7-8cb0-4f67-a411-c651c15146d9`)                                                           |
| Issue log                                               | Notion database [`Tagalong Issues`](https://app.notion.com/p/fbe46b28758244c586dde6f27f9696ac) (`collection://081abced-a751-43c3-90af-8ea129b6a226`) |
| Manual tests for the current build                      | `docs/testing/feature-test-guide.md`                                                                                                                 |

Fetch the phase page before starting the phase. Fetch the task rows before starting each task.

## The loop, per task

1. Set the Notion task `Status` to `In progress`.
2. **Write the failing test first.** No production code without a test that motivated it.
3. Make it pass. Refactor.
4. Update `README.md`, the subsystem doc in `docs/` (the index is `docs/README.md`;
   `docs/architecture.md` for the processes, packages and the life of a turn), `protocol/README.md`
   for a new contract message, and any doc the change invalidates. Docs are part of
   done, not a follow-up.
5. Commit with a Conventional Commit message scoped to the package
   (`feat(core): add PromptAssembler`, `chore(repo): add eslint flat config`).
6. Set the task `Status` to `Done` only when its `Acceptance` text is literally satisfied.

## The loop, per phase

1. Read the phase page in Notion, then every task row for that phase ordered by `Order`.
2. Work tasks in `Order`. Do not skip ahead; later tasks assume earlier ones landed.
3. Record every error as a row in the Notion `Tagalong Issues` database as you hit it — every
   error, blocker and workaround of the phase, including the process mistakes, not only the
   ones still unfixed at the end. The repo must **not** carry an issue log of its own — no
   issues folder under `docs/`; errors live in Notion, where they can be filtered and reopened.
4. Run the phase acceptance script and record the result, with the date and notes from the
   real run, on the phase's Notion page. Add or update the feature's steps in
   `docs/testing/feature-test-guide.md`.
5. Push, then report to the human: what shipped, what the acceptance run showed, what is
   blocked on them.
6. Stop and wait. The human may amend the next phase before it starts.

## Invariants that outrank convenience

- **The contract package is pure.** `protocol/ts` depends on zod only and must never import `electron`,
  `react`, or DOM globals. An ESLint `no-restricted-imports` rule enforces it — if that rule
  fires, fix the import, never the rule.
- **No computer control, ever.** No mouse or keyboard automation anywhere in the repo. The one
  exception already in the plan is the Ctrl+C selection trick in the desktop host, which is
  scoped to reading the selection and restoring the clipboard.
- **Test with the fake provider. Always.** Every test, every manual check, every launch you
  do yourself runs on a fake brain (the e2e fake brain in `bodies/desktop/e2e/fixtures`). **Never** run a real Anthropic, OpenAI or ElevenLabs call to verify your own work.
  The user pays per token for API calls; burning their budget to satisfy your curiosity is not
  yours to spend. Acceptance steps that genuinely need a real provider — "the answer references
  the selected text" — are handed to the user to run, listed under "Needs a human run", and left
  unticked. Only switch to a real provider when the user asks for it in that session; a previous
  session's permission does not carry over.
- **Never overengineer.** Build what the current task needs. An interface exists only where the
  plan names a second implementation.
- **Secrets never enter git.** Env vars in development, OS keychain in the packaged app. Every
  variable used anywhere must appear in `.env.example`.
- **Diagrams are Mermaid, black and white theme only.**
- **No AI attribution anywhere.** Nothing in this project credits Claude, Claude Code, Anthropic
  or any AI as an author or contributor — not in commit messages or trailers, PR titles or
  bodies, the README, `docs/`, acceptance records, code comments, or Notion pages and task
  updates. No `Co-Authored-By: Claude`, no "Generated with", no "🤖", no "written by an agent"
  note. The work is the user's and ships under their name alone. Naming Anthropic as a **vendor**
  is different and fine — the `AnthropicProvider`, the Claude API, the model ids, and the
  Claude sign-in all stay. The test is authorship,
  not the word: say who built it, never that an AI did.

## Commit sizing

Keep each commit between roughly 500 and 800 changed lines. When a task produces more, split it
along natural seams — config, then sources, then tests, then docs. Check before committing:

```bash
git diff --cached --shortstat
```

Generated lockfiles are the usual cause of an oversized commit; commit `pnpm-lock.yaml` on its
own when it dominates the diff.

## Branching and pull requests

Never commit to `main`. Every unit of work goes through a branch and a merged PR.

1. Branch from an up-to-date `main`: `feat/phase-<N>-<workstream>` (for example
   `feat/phase-1-protocol`, `feat/phase-1-providers`). One branch per workstream, not per
   phase — a 17-task phase in one PR is not reviewable.
2. Commit to the branch in the 500-800 line slices described above.
3. Push and open a PR with `gh pr create`. The body states what shipped, which Notion task IDs
   it closes, and how the acceptance text was verified.
4. Wait for CI to pass on the PR. A red PR is never merged.
5. Merge with `gh pr merge --squash --delete-branch`, then pull `main` before the next branch.
6. No AI attribution in the branch, commits or PR — see the invariant above.

A phase is finished when every one of its workstream PRs is merged and `main` is green.

## Recording decisions

When a choice is non-obvious — a library swap, a protocol shape, a deviation from the phase
page — add a row to `Tagalong Decisions` before moving on. A decision you had to think about is
a decision the next agent will have to re-think unless it is written down.

## Red flags — stop and re-read the phase page

- About to import `electron` or `react` into `core` or `protocol`
- About to write production code with no failing test behind it
- About to mark a task `Done` without running its `Acceptance` text
- About to start phase N+1 while a phase N task is still `Not started`
- Reaching for a mouse/keyboard automation library
- About to make a real API call to check your own work — use the fake provider
- About to write `Co-Authored-By`, "Generated with", "🤖", or any note that an AI did the work
- About to tick an acceptance item that needs a real provider, instead of handing it to the user
