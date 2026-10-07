# Roles, directory and tools

**Status: partly built** for Phase 8 (Roles). The role files, the generated role library, the tier
table and its lookup helpers, and [the tools module](#the-tools-module) are **built**. Giving a pet a
role, the directory and tool grants are still **design**. The design page with the full task list
lives in the Notion plan.

## Roles

Every pet has exactly one role. A user who wants more roles creates more pets. Tagalong ships the
roles; custom roles are parked for later, and the file format already allows them.

The first five:

| Role              | Good at                                     | Recommended brain       |
| ----------------- | ------------------------------------------- | ----------------------- |
| Generalist        | Explaining, summarising, answering anything | Balanced                |
| Backend engineer  | APIs, databases, stack traces, CI           | Deep                    |
| Frontend engineer | UI code, CSS, browser bugs, accessibility   | Balanced, sees pictures |
| Writer            | Emails, docs, rewrites, release notes       | Balanced                |
| Researcher        | Reading pages and papers, comparing sources | Deep                    |

### The role file

**Built.** One Markdown file per role in `packages/core/roles/`. The YAML header is data; the body is the
role's instructions.

```markdown
---
id: backend-engineer
name: Backend engineer
version: 1
summary: Fixes servers, databases and broken builds.
good_at: [APIs, databases, stack traces, CI pipelines]
not_for: [visual design, marketing copy]
tools: [look_at_screen, get_selection, read_window_text, list_windows, watch_for, remember, ask_pet]
model:
  tier: deep # fast | balanced | deep
  needs_vision: false
---

You are a backend engineer. Read the error first, name the cause in one line, then show the fix.
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

`packages/core/src/roles/` reads the library: `listRoles()`, `getRole(id)` (undefined for an
unknown id) and `recommendedModel(role, providerId)`. No pet uses a role yet; that wiring is
still design.

## The directory: how pets know who can do what

Like colleagues reading a team directory, each pet sees a card for every teammate it can reach:

| Card field       | Comes from                                       |
| ---------------- | ------------------------------------------------ |
| Name             | The pet                                          |
| Role and summary | The role file                                    |
| Good at, not for | The role file                                    |
| Can reach        | The pet's granted tools                          |
| Sees pictures    | The pet's model                                  |
| Brain            | The pet's model: fast, balanced, deep, or custom |

A pet's persona and memories are never on its card.

To decide who to ask, a pet is told to apply, in order:

1. **Access first.** Only a pet with the tool the job needs can do it.
2. **Best role match** among those.
3. **Two parts, two people.** A task needing two roles is a meeting with both.
4. **Tie-break** on the cheaper brain.
5. **No one fits:** say so rather than ask the wrong pet.

## Model per pet

The model is a pet setting, not a role setting: two Backend engineers can run on different
providers. The role only recommends.

- Each role names a `tier` (fast, balanced, deep) and whether it needs pictures.
- **Built:** a table in `packages/core/src/roles/tiers.ts` maps tiers to models for each provider,
  and `recommendedModel(role, providerId)` reads it:

  | Provider   | Fast                             | Balanced                            | Deep                                |
  | ---------- | -------------------------------- | ----------------------------------- | ----------------------------------- |
  | OpenRouter | `anthropic/claude-haiku-4.5`     | `anthropic/claude-sonnet-5`         | `anthropic/claude-opus-5`           |
  | Anthropic  | `claude-haiku-4-5`               | `claude-sonnet-5`                   | `claude-opus-5`                     |
  | Nebius     | `nvidia/nemotron-3-nano-30b-a3b` | `nvidia/nemotron-3-super-120b-a12b` | `nvidia/nemotron-3-super-120b-a12b` |

  On Nebius, a role that needs pictures also gets `nvidia/Nemotron-Nano-V2-12b` as its vision
  model, because the tier model cannot see. OpenRouter and Anthropic models see on their own.

- Design from here on. Creating a pet prefills the model from that table for the chosen provider; the user can pick any
  model on the provider's live list.
- When the role needs pictures and the model cannot see, a vision model is set automatically, using
  the existing vision routing.

## What a pet stores

The pet is stored as JSON in the `pets` table of `tagalong.db`:

| Field                                              | Change in Phase 8                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `roleId`, `roleVersion`                            | New                                                                      |
| `toolGrants`                                       | New: tool id → `off` or `allowed`; defaults to the role's tools, allowed |
| `toolAllowlist`                                    | Removed: never read                                                      |
| `persona`                                          | Becomes optional `notes`; a persona the user edited is kept as notes     |
| `name`, `avatar`, `color`                          | Unchanged                                                                |
| `providerId`, `model`, `visionModel`, `watchModel` | Unchanged                                                                |

Logins and API keys stay encrypted in `secrets.json`, never in the pet.

## The tools module

**Status: built.** Roles and grants on top of it are still design.

All 12 built-in tools live in one module, in one shape, and reach a turn one way:

```text
packages/core/src/tools/
  tool.ts          one Tool shape: id (the tool name), definition, kind (read | write), run(input, ctx)
  registry.ts      ToolRegistry.forTurn: builds a turn's tools, filters them through toolsFor(pet),
                   and dispatches every call
  index.ts         what the rest of core imports
  fake-turn.ts     fakeTurn and fakeTurnTools, for testing tools without a runner
  builtin/
    perception.ts  look_at_screen, get_selection, list_displays, look_at_display,
                   look_closer, list_windows, read_window_text
    awareness.ts   recall_screen, what_changed, watch_for
    crew.ts        remember, ask_pet
```

- **Kind.** A tool is `write` when it leaves stored state behind after the turn: `remember` files a
  memory, `watch_for` starts a watch. The other ten are `read`; `ask_pet` costs a model call but
  stores nothing.
- **Context.** Every tool runs with the turn's pet, turn id, abort signal, snapshot, whether the
  pet's brain can see, and a counter for nested model calls.
- **Which tools a turn gets.** The registry builds what the engine is wired for, in a fixed order,
  and returns none when the pet's provider cannot call tools. `ask_pet` is left off roundtable
  turns and off a crew of one. An unknown name is refused by name.
- **`toolsFor(pet, tools)`** is the single place a turn's tools are narrowed. Today it returns every
  tool; Phase 8 plugs the role's tools and the pet's grants in here.

The runner asks the registry for a turn's tools and dispatches through it. An ESLint rule keeps
`conversation/` and `engine.ts` importing tools only from `tools/registry` or the `tools` index,
never from `tools/builtin/*`. To add a built-in, follow the repo skill
`.claude/skills/tagalong-add-tool/SKILL.md`.

Tools that need a login (GitHub, Notion and others) arrive with Hands: the user connects a service
once in Settings, then grants it per pet as off, ask me, or allowed.
