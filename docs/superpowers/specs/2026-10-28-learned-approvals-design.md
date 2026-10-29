# Learned approvals: design

Date: 2026-10-28. Launch board row "Learned approvals" (Step 2, builds on Row 10).

## Intent

Today every permission ask reaches the person, and nothing remembers the answers. The person
keeps approving the same things (for example Claude Code running git commands in their repo).
Scout should learn from those answers and offer to take over a kind of approval, but only with
the person's explicit yes, and every approval must stay visible.

The person is always in charge. Approval never goes away: Scout either asks, or acts under a
preference the person agreed to in so many words.

## Goals

- Save every approval ask and how it ended, from every source: Scout's own tools (the tool
  gate, `toolbox.py`), Claude Code's permission prompts (`jobs.py` `_permission`), and
  connected-app tools.
- Scout notices patterns and offers: "You've approved Claude Code running git commands in
  ai_pet 6 times. Should I auto-approve these from now on?" Options: "Yes, auto-approve" /
  "Keep asking".
- On "Yes", save a **preference**: a plain-language sentence (e.g. "Git commands in my repos
  are fine"), plus the source and tool it came from.
- When a new ask arrives and the person has preferences, Scout decides first: answer for the
  person under a preference, or pass it to the person.
- Every approval Scout gives is reported to the person and shown in the history.
- Home gets an Approvals page: preferences (with Remove) and the full history.

## Non-goals

- No rules engine, no allowlists, no command parsing, no pattern matching in code. Code
  decides _when_ Scout looks; Scout (the model) decides _if_ a preference covers an ask and
  _what_ to offer.
- No automatic preferences. Counts trigger a look, never a switch.
- No change to the existing per-tool Ask/Auto modes; Auto tools still never ask.

## Anti-goals (failure even if it works)

- Scout approves something because it is "close to" a preference. Only an ask the preference
  clearly covers may be approved; when unsure, Scout passes it to the person.
- A preference is created without the person's explicit yes.
- An approval happens that the person cannot later see on the Approvals page.
- Asks get slower or cost budget for a person who has no preferences.

## Decisions (the person's)

1. Scout acts only under a saved preference, never on its own judgment of similarity.
2. Every preference is born from an explicit "Should I switch to auto-approve this?" and the
   person's yes.
3. All approvals are kept and visible on Home.
4. Nothing is locked in code. Risky tools (today `locked`, body tools with `confirm: true`)
   start with a default preference "Always ask me before risky actions", shown on the page
   like any other; the person can remove or change it. While it exists, Scout never answers
   a risky ask for the person.
5. Home layout: option A from the mockup (one page, preferences on top, history below), plus
   a summary strip of counts above the history (from option B). Mockup:
   `.superpowers/brainstorm/56893-1793241461/content/approvals-home.html`.

## Decisions (Claude's calls, adjustable after testing)

- **When Scout looks first:** only if the person has at least one preference they created
  (the risky-actions default does not count). With none, asks go straight to the person as
  today: no wait, no cost.
- **How Scout decides:** a short, separate decision turn (like 10d's `scout.ask` for expert
  questions), never inside the turn that wants the tool. Scout sees the ask, the preferences
  and the recent history for that tool, and ends with one of two tools: approve under a named
  preference, or pass to the person. Deny is never Scout's call; a refusal is the person's.
- **The decision turn is a standalone model call**, not a session turn: it does not touch the
  conversation history, runs alongside whatever Scout is doing (a running turn, a chat, 10d's
  question look), and so works for tool-gate asks raised inside a running turn. It counts
  toward the guardrails budget.
- **Approving means "allow once".** For Claude Code, Scout returns the agent's allow-once
  option, never allow-always. History maps Claude Code outcomes by the option's kind
  (allow / reject), not its display name.
- **Risk for Claude Code asks is Scout's judgment.** Claude Code asks carry no risk flag, so the
  "Always ask me before risky actions" default is a sentence Scout interprets like any other
  (e.g. `git push --force` or deleting files is risky; `git status` is not). For Scout's own
  and app tools marked `locked`/`confirm`, code also enforces it: while the default exists,
  Scout cannot approve them. If the person removes the default, Scout may approve those
  under another preference.
- **Fallbacks:** decision turn errors, times out (20 s), or hits the budget → the ask goes to
  the person. Nobody online → today's behaviour.
- **When Scout considers an offer:** after the person approves an ask, the brain checks the
  _group_ it belongs to: for Claude Code, the job's folder (all Claude Code tools in one
  folder are one group, since titles vary per command); for Scout and app tools, the tool
  name. If the group has 3+ approvals by the person in the last 14 days, Scout gets one quiet
  look at that group's history and decides whether to offer and what the sentence covers
  (e.g. only the git commands). Code never groups beyond that. Caps are per group: at most one
  offer per day; after "Keep asking", none for 7 days. These numbers are settings.
- **History rows** record the final outcome only. If Scout passes an ask on (or the decision
  turn fails), the row records the person's answer; the pass itself is not a row.
- **The offer** is an ask (options "Yes, auto-approve" / "Keep asking") with Scout's proposed
  sentence. Scout writes the sentence; the person can edit it from Home later. Editing in the
  offer card itself is out of scope.
- **Today's "Always" button** on a tool ask stays and keeps setting the tool to Auto (existing
  behaviour); it is recorded in the history like any answer.
- **Reporting:** when Scout approves, bodies get a notification shown as a small card ("Approved
  for you: Claude Code `git status` in ai_pet — per 'Git commands in my repos are fine'").
  It is a UI notice, not a Scout line.
- **Removing a preference** takes effect at once; the next matching ask comes to the person.

## What is saved

- **Approval history** (brain SQLite, `memory.py` style): source (scout tool / claude code /
  connected app), tool name, a short description of what was asked and its input, job id when
  there is one, outcome (approved / refused / timed out / no one online), who decided (person,
  Scout + preference id), time.
- **Preferences:** id, sentence, source and tool it came from, created time, use count, last
  used, and whether it is the built-in risky-actions default.
- The history is never pruned in this row.

## Pieces

- Brain: history and preference store; recording at the three ask points; the decision turn
  and its two tools; the offer trigger with caps; the report notification.
- Contract (`protocol/README.md`, `protocol/ts`, `brain/src/brain/protocol.py`): methods for
  Home to list history (with the three filters: all / decided by Scout / refused), list
  preferences, remove and edit a preference; the report notification; a `changed` kind for
  approvals.
- Bodies (`bodies/ui`, `bodies/desktop`): the Approvals page on Home, the offer card (an ask
  with custom options, already supported), the report card.
- Docs: `docs/brain.md`, the matching subsystem docs, `docs/testing/feature-test-guide.md`,
  README.md.

## Left to the builder

- Table and method names, exact filters' SQL, pagination size.
- Prompt wording for the decision turn and the offer look (in `mind/`, following
  `mind/events.md` style).
- How the summary strip counts are computed.
- How the slices split the work, keeping each PR within 500-1,000 changed lines.
