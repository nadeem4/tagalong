# Roles and tools

**Status: built.** The role file, the generated role library, the tier table and its lookup
helpers, giving a pet a role, filtering a turn's tools by role, and
[the tools module](#the-tools-module).

The crew-era roles (Generalist, Backend engineer, Frontend engineer, Writer, Researcher), the
`ask_pet` tool and its teammate directory, the `roles.list` and `roles.recommendModel` methods, the
office's job labels and the one-time roles notice were removed with the crew.

## The role

Tagalong ships one role, the **Companion**, and one pet, Scout, works as it. Quick things are the
Companion's own (explaining, short drafts, translating, reading aloud, describing a picture); a
draft goes alone in a fenced `draft` block that the bubble shows with **Copy**. Real work goes to
an expert. "File this as a bug" goes to the connected app's create-issue tool, so the person sees
it in full on the confirm card first; it never guesses a repo. Its tools are only the ones that look (screen, selection, windows), `remember`,
`hand_to_expert`, which writes a brief and hands it to an expert such as Claude Code, the tools of
the person's connected apps (`connections`), whose changes always ask first, `create_routine`
and `change_routine`, which show a routine card the person saves, `point_at`, which draws a ring
around something on screen and never clicks, `search_history`, which searches the window titles
it looked at and the person's asks by words, or, with no words, lists everything in a time range
("what did we do today?"), `tell_expert`, which passes the person's words to an expert
already working, `change_settings`, which shows a settings card the person applies with a
click, `forget`, which lists or deletes one of its memories or finished jobs, and its own
background work: `work_on_it` starts a job, `board` lists everything in flight and finished today,
`open_result` gives a whole result and `stop_work` stops a job, a hand-off or a watch; it has
nothing that writes files or runs code. Its own figure and bubble show up in its
screenshots, and its instructions say so.

Who Scout is lives apart from what Scout can do: the **soul** (below) is Scout's character, and the
role is the tools, the model tier and the mechanics of how Tagalong works.

### The soul file

`packages/core/soul/scout.md` is Scout's soul: plain Markdown, no header, exactly three parts in
this order, each with something under it:

| Heading          | What it holds                      | Edit it to                                           |
| ---------------- | ---------------------------------- | ---------------------------------------------------- |
| `## Character`   | How Scout is and sounds            | change Scout's personality                           |
| `## Cares about` | What Scout values, as bullets      | change Scout's priorities                            |
| `## Never`       | Lines Scout doesn't cross, bullets | change the wording (the guarantees are also in code) |

The safety lines in Never are enforced by code too: Scout has no click or type tool, every card
needs a click, and blind spots and secret hiding happen before anything reaches the model. So
editing the wording cannot remove a guarantee.

The same generator compiles every `soul/*.md` into `SOUL_LIBRARY` in `library.generated.ts`,
keyed by file name, and fails on a missing, extra, empty or misordered part. `ACTIVE_SOUL` in
`packages/core/src/roles/index.ts` (`'scout'`) picks the soul and `soul()` returns its text.

Every mind speaks from the same soul. A turn's system prompt is the soul, the role's body and their
name. Every other mind's is `modeSystem(block)`: the soul, then that mode's own block. The modes
are checking in (`## Checking in`), tidying memory (`DIGEST_INSTRUCTIONS`) and summarising
(`## Summarising`). So what Scout says, keeps and judges all comes from one self. A watch's yes/no
check is the exception: a frequent matcher is plumbing, not speech, so it gets a fixed instruction
and no soul.

To re-character Scout, edit `soul/scout.md` and regenerate. For a second character, add
`soul/<id>.md` and change `ACTIVE_SOUL`; there is no setting or picker until a second soul ships.

### The role file

One Markdown file per role in `packages/core/roles/` (today only `companion.md`). The YAML header is
data; the body is the role's instructions. The companion's body is short, about a dozen bullets under
one heading, `## How Tagalong works`: mechanics only (look, talk and point, never click; quick
things are Scout's and real work goes to an expert; cards need a click; keys and logins only in
Settings, the calendar link only in Home's Meeting prep form; a connected app gets nothing from
the screen unless they asked; a bug's repo is never guessed; a draft goes alone in a fenced `draft` block, which the bubble gives a Copy button; everything
Scout writes is spoken except what it puts in a block (drafts, code, long lists); the
voice speaks only English, so other languages go in a `"> "` quote; Scout's own figure shows up
in screenshots; what `[hidden: …]` means; what rides at the end of the person's message). How
Scout behaves is the soul's job, and how each tool is used is in the tool's own description. The
generator keeps the body as written.

```markdown
---
id: companion
name: Companion
version: 2
summary: Sees what you are doing, briefs the right expert, and brings the answer back.
good_at: [working out what you need, writing a clear brief, picking the right expert]
not_for: [doing the work itself]
tools:
  - look_at_screen
  - get_selection
  - list_windows
  - read_window_text
  - look_at_window
  - remember
  - hand_to_expert
  - connections
  - create_routine
  - change_routine
  - point_at
  - search_history
  - tell_expert
  - change_settings
  - forget
  - work_on_it
  - board
  - open_result
  - stop_work
  - self_read
  - self_write
model:
  tier: balanced # fast | balanced | deep
  needs_vision: false
---

## How Tagalong works

- You can look at their screen, talk and point. You have no way to click or type.
- ...
```

A script compiles the files into `packages/core/src/roles/library.generated.ts`, which is
committed: core is compiled with `tsc` and bundled into Electron, so reading `.md` files at runtime
would break after bundling. A test fails when the generated file is stale, a role file is invalid,
a role's id does not match its file name, or a role names a tool that does not exist.

The script is `packages/core/scripts/gen-roles.mjs`. After editing a role or soul file, regenerate
with `pnpm --filter @tagalong/core gen:roles` (or `node scripts/gen-roles.mjs` from
`packages/core`) and commit both files. Each file is validated against the
`Role` schema in `packages/protocol/src/roles.ts`, where the header's snake_case keys become
camelCase (`good_at` becomes `goodAt`, `model.needs_vision` becomes `model.needsVision`) and the
body becomes `instructions`.

`packages/core/src/roles/` reads the library: `getRole(id)` (undefined for an unknown id),
`roleFor(id)` (the companion for an unknown id, such as a crew-era `writer`) and
`recommendedModel(role, providerId)`. `getRole` and `recommendedModel` are exported from
`@tagalong/core` for hosts; Welcome uses them to move Scout to a provider on the right model.
`pets.upsert` refuses a pet other than Scout, or one whose `roleId` is not in the library, with RPC
error `-32602`.

### What the role decides

A pet's role sets two things on every turn:

- **Its instructions.** The system prompt is the soul, then the role's `instructions`, then
  `Their name is <name>.` when the person gave one. Nothing else, so it is the same on every turn
  and providers can cache it. Recalled memories and the Now facts ride on the person's message
  instead (see `docs/architecture.md`, "The prompt").
- **Its tools.** `toolsFor` gives the pet exactly the tools its role lists.

A pet whose `roleId` is not in the library works as the companion, for both.

## Model per pet

The model is a pet setting, not a role setting. The role only recommends: it names a `tier` (fast,
balanced, deep) and whether it needs pictures, and a table in `packages/core/src/roles/tiers.ts` maps
tiers to models for each provider, read by `recommendedModel(role, providerId)`:

| Provider    | Fast                         | Balanced                    | Deep                      |
| ----------- | ---------------------------- | --------------------------- | ------------------------- |
| OpenRouter  | `anthropic/claude-haiku-4.5` | `anthropic/claude-sonnet-5` | `anthropic/claude-opus-5` |
| Anthropic   | `claude-haiku-4-5`           | `claude-sonnet-5`           | `claude-opus-5`           |
| Claude Code | `haiku`                      | `sonnet`                    | `opus`                    |

Every model in the table sees, so a role that needs pictures gets the same model.

## What a pet stores

The pet is stored as JSON in the `pets` table of `tagalong.db`, validated by the `Pet` schema in
`packages/protocol/src/pet.ts`: `id` (always `SCOUT_ID`, `scout`), `name`, `avatar`, `color`,
`roleId`, `providerId`, `model` and `watchModel`. The schema drops keys it does not know, so a pet
stored by an older version still parses: `persona` and `toolAllowlist` from before roles,
`roleVersion`, `voiceId`, `toolGrants`, `replyStyle` and `notes` from the crew, and `visionModel`
from when a provider routed pictures to a second model.

A fresh install has one pet, Scout, as the Companion. Database migration 5
(`packages/core/src/pets/roles-upgrade.ts`) gave pets stored before roles a role id and moved an
edited `persona` to `notes`; migration 11 removed Ink and Bolt; migration 14 drops the roles notice's
table; migration 20 keeps only Scout, deleting any other pet with its conversations, and takes
`toolGrants`, `replyStyle`, `notes` and `color` off Scout's stored record.

Logins and API keys stay encrypted in `secrets.json`, never in the pet.

## The tools module

All built-in tools live in one module, in one shape, and reach a turn one way:

```text
packages/core/src/tools/
  tool.ts          one Tool shape: id (the tool name), definition, kind (read | write), run(input, ctx)
  registry.ts      ToolRegistry.forTurn: builds a turn's tools, filters them through toolsFor(pet),
                   and dispatches every call
  index.ts         what the rest of core imports
  fake-turn.ts     fakeTurn and fakeTurnTools, for testing tools without a runner
  builtin/
    perception.ts  look_at_screen, get_selection, list_displays, look_at_display,
                   look_closer, list_windows, read_window_text, look_at_window
    awareness.ts   recall_screen, what_changed, watch_for
    memory.ts      remember, forget
    experts.ts     hand_to_expert, tell_expert
    connections.ts <connection>__<tool>: every tool of the person's connected apps
    routines.ts    create_routine, change_routine
    pointing.ts    point_at
    history.ts     search_history
    settings.ts    change_settings: the chat allowlist, labels and loosening rules
    jobs.ts        work_on_it, board, open_result, stop_work: Scout's own jobs and the task board
    self.ts        self_read, self_write: Scout's own notes, the Self
```

The companion's role lists every one of them; `point_at` comes after `change_routine`, then
`search_history` and `tell_expert`, then `change_settings`, `forget` (never on a routine's own
turn), the four job tools, and `self_read` and `self_write` last (`self_write` never on a
routine's own turn).

- **Kind.** A tool is `write` when it leaves stored state behind after the turn: `remember` files a
  memory, `forget` deletes one, `watch_for` starts a watch, `hand_to_expert` starts a hand-off, `tell_expert` queues a note in a running hand-off and its Activity row,
  `create_routine` and `change_routine` lead to a saved routine once the person presses Save, and
  `change_settings` to saved settings once they click Apply, `work_on_it` starts a job,
  `stop_work` stops one and `self_write` changes a page of Scout's notes (or, for `lessons.md`
  and skills, proposes the change for the person to accept). The rest are `read`.
- **Context.** Every tool runs with the turn's pet, turn id, abort signal, snapshot, whether the
  pet's brain can see, and, on a routine's turn, the routine (`ToolContext.routine`): the expert its
  card allowed and where a hand-off reports.
- **Which tools a turn gets.** The registry builds what the engine is wired for, in a fixed order,
  and returns none when the pet's provider cannot call tools. `hand_to_expert` is built only when an
  expert is switched on, and lists every such expert and what it is good at in its description;
  the model picks one with `expert_id`, which is required when more than one is on. The
  routine tools are left off a routine's own turn, and `change_routine` is built only when a routine
  is saved. `tell_expert` is built only while a hand-off is running, never on a routine's own turn,
  and lists the running hand-offs (id, expert, ask) in its description. `change_settings` is
  offered on a routine's turn too, but refuses there any change that lets Scout see, keep or spend
  more. A routine's turn gets `board` and `open_result` but not `work_on_it` or `stop_work`. A
  job's own turn (`ToolContext.job`) keeps only `search_history` and the connected apps' read
  tools. An unknown name is refused by name.
- **`toolsFor(pet, tools)`** is the single place a turn's tools are narrowed: the tools the pet's
  role lists (see [What the role decides](#what-the-role-decides)).
  A role can list a group instead of single tools: `connections` gives it every tool of the
  person's connected apps, whose names are only known once they connect.
- **Results are facts.** A tool result says what happened ("No connected host can take a
  screenshot.", "The brief is on a card; it starts when they press Send."), never what to say: no
  "Tell the user…" or "Say…". The model decides if and what to tell them; each rule (cards need a
  click, keys only in Settings) is said once, in the soul or the companion's mechanics. Tests
  check this with `directivesIn` (`tools/test-support.ts`).
- **Connected apps.** An app tool is `read` when its server marks it read-only and `write`
  otherwise, unknown included. A write asks the person first with a confirm card and runs only on
  Allow once; see [Connected apps](../architecture.md#connected-apps-mcp).

The runner asks the registry for a turn's tools and dispatches through it. An ESLint rule keeps
`conversation/` and `engine.ts` importing tools only from `tools/registry` or the `tools` index,
never from `tools/builtin/*`. To add a built-in, follow the repo skill
`.claude/skills/tagalong-add-tool/SKILL.md`.
