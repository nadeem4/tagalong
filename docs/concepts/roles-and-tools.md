# Roles and tools

**Status: built.** The role file, the generated role library, the tier table and its lookup
helpers, giving a pet a role, filtering a turn's tools by role and grants, and
[the tools module](#the-tools-module).

The crew-era roles (Generalist, Backend engineer, Frontend engineer, Writer, Researcher), the
`ask_pet` tool and its teammate directory, the `roles.list` and `roles.recommendModel` methods, the
office's job labels and the one-time roles notice were removed with the crew.

## The role

Tagalong ships one role, the **Companion**, and one pet, Scout, works as it. The Companion never does
the work itself, with one exception: short drafts (an email reply, a message, a PR description, up
to about 400 words), which it writes alone in a fenced `draft` block that the bubble shows with
**Copy**. Anything longer goes to an expert, and it never says it sent, pasted or typed a draft.
"File this as a bug" is written the same way but goes to the connected app's create-issue tool, so
the person sees it in full on the confirm card first; it never guesses a repo. Its tools are only the ones that look (screen, selection, windows), `remember`,
`hand_to_expert`, which writes a brief and hands it to an expert such as Claude Code, the tools of
the person's connected apps (`connections`), whose changes always ask first, `create_routine`
and `change_routine`, which show a routine card the person saves, and `point_at`, which draws a ring
around something on screen and never clicks; it has nothing that writes files or runs code. Its own figure and bubble show up in its screenshots, so its instructions tell it to look
past them and never mention itself or Tagalong unless asked.

### The role file

One Markdown file per role in `packages/core/roles/` (today only `companion.md`). The YAML header is
data; the body is the role's instructions.

```markdown
---
id: companion
name: Companion
version: 1
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
model:
  tier: fast # fast | balanced | deep
  needs_vision: false
---

You are a companion: you sit beside the person's work, ...
```

A script compiles the files into `packages/core/src/roles/library.generated.ts`, which is
committed: core is compiled with `tsc` and bundled into Electron, so reading `.md` files at runtime
would break after bundling. A test fails when the generated file is stale, a role file is invalid,
a role's id does not match its file name, or a role names a tool that does not exist.

The script is `packages/core/scripts/gen-roles.mjs`. After editing a role file, regenerate with
`pnpm --filter @tagalong/core gen:roles` and commit both files. Each file is validated against the
`Role` schema in `packages/protocol/src/roles.ts`, where the header's snake_case keys become
camelCase (`good_at` becomes `goodAt`, `model.needs_vision` becomes `model.needsVision`) and the
body becomes `instructions`.

`packages/core/src/roles/` reads the library: `getRole(id)` (undefined for an unknown id),
`roleFor(id)` (the companion for an unknown id, such as a crew-era `writer`) and
`recommendedModel(role, providerId)`. `getRole` and `recommendedModel` are exported from
`@tagalong/core` for hosts; Welcome uses them to move Scout to a provider on the right model.
`pets.upsert` refuses a pet whose `roleId` is not in the library with RPC error `-32602`.

### What the role decides

A pet's role sets two things on every turn:

- **Its instructions.** The system prompt is the base rules, then the role's `instructions`, then
  `Your name is <name>.`, then the pet's `notes` under the heading "The user's notes for you" when
  there are any, then the reply-style rule and the recalled memories.
- **Its tools.** `toolsFor` gives the pet exactly the tools its role lists, minus any its
  `toolGrants` set to `off`. A grant cannot add a tool the role does not list.

A pet whose `roleId` is not in the library works as the companion, for both.

## Model per pet

The model is a pet setting, not a role setting. The role only recommends: it names a `tier` (fast,
balanced, deep) and whether it needs pictures, and a table in `packages/core/src/roles/tiers.ts` maps
tiers to models for each provider, read by `recommendedModel(role, providerId)`:

| Provider    | Fast                             | Balanced                            | Deep                                |
| ----------- | -------------------------------- | ----------------------------------- | ----------------------------------- |
| OpenRouter  | `anthropic/claude-haiku-4.5`     | `anthropic/claude-sonnet-5`         | `anthropic/claude-opus-5`           |
| Anthropic   | `claude-haiku-4-5`               | `claude-sonnet-5`                   | `claude-opus-5`                     |
| Claude Code | `haiku`                          | `sonnet`                            | `opus`                              |
| Nebius      | `nvidia/nemotron-3-nano-30b-a3b` | `nvidia/nemotron-3-super-120b-a12b` | `nvidia/nemotron-3-super-120b-a12b` |

On Nebius, a role that needs pictures also gets `nvidia/Nemotron-Nano-V2-12b` as its vision model,
because the tier model cannot see.

## What a pet stores

The pet is stored as JSON in the `pets` table of `tagalong.db`, validated by the `Pet` schema in
`packages/protocol/src/pet.ts`: `id`, `name`, `avatar`, `color`, `roleId`, `notes`, `providerId`,
`model`, `visionModel`, `watchModel`, `toolGrants` (tool id → `off` or `allowed`; the default `{}`
allows every tool the role lists) and `replyStyle`. The schema drops keys it does not know, so a pet
stored by an older version still parses: `persona` and `toolAllowlist` from before roles, and
`roleVersion` and `voiceId` from the crew.

A fresh install has one pet, Scout, as the Companion, with no notes. Database migration 5
(`packages/core/src/pets/roles-upgrade.ts`) gave pets stored before roles a role id and moved an
edited `persona` to `notes`; migration 11 removed Ink and Bolt; migration 14 drops the roles notice's
table.

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
    memory.ts      remember
    experts.ts     hand_to_expert
    connections.ts <connection>__<tool>: every tool of the person's connected apps
    routines.ts    create_routine, change_routine
    pointing.ts    point_at
```

The companion's role lists every one of them; `point_at` comes last, after `change_routine`.

- **Kind.** A tool is `write` when it leaves stored state behind after the turn: `remember` files a
  memory, `watch_for` starts a watch, `hand_to_expert` starts a hand-off and remembers which expert
  took that kind of task, and `create_routine` and `change_routine` lead to a saved routine once the
  person presses Save. The rest are `read`.
- **Context.** Every tool runs with the turn's pet, turn id, abort signal, snapshot, whether the
  pet's brain can see, and, on a routine's turn, the routine (`ToolContext.routine`): the expert its
  card allowed and where a hand-off reports.
- **Which tools a turn gets.** The registry builds what the engine is wired for, in a fixed order,
  and returns none when the pet's provider cannot call tools. `hand_to_expert` is built only when an
  expert is switched on, and lists every such expert and what it is good at in its description. The
  routine tools are left off a routine's own turn, and `change_routine` is built only when a routine
  is saved. An unknown name is refused by name.
- **`toolsFor(pet, tools)`** is the single place a turn's tools are narrowed: the tools the pet's
  role lists, minus any its grants turn off (see [What the role decides](#what-the-role-decides)).
  A role can list a group instead of single tools: `connections` gives it every tool of the
  person's connected apps, whose names are only known once they connect.
- **Connected apps.** An app tool is `read` when its server marks it read-only and `write`
  otherwise, unknown included. A write asks the person first with a confirm card and runs only on
  Allow once; see [Connected apps](../architecture.md#connected-apps-mcp).

The runner asks the registry for a turn's tools and dispatches through it. An ESLint rule keeps
`conversation/` and `engine.ts` importing tools only from `tools/registry` or the `tools` index,
never from `tools/builtin/*`. To add a built-in, follow the repo skill
`.claude/skills/tagalong-add-tool/SKILL.md`.
