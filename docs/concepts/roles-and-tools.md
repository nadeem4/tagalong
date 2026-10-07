# Roles, directory and tools

**Status: design** for Phase 8 (Roles). The design page with the full task list lives in the Notion
plan.

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

One Markdown file per role in `packages/core/roles/`. The YAML header is data; the body is the
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
or a role names a tool that does not exist.

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
- A table next to the provider presets maps tiers to models for each provider.
- Creating a pet prefills the model from that table for the chosen provider; the user can pick any
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

Today 12 built-in tools live in six files across four folders, in two shapes (`PerceptionToolset`
and `CrewTool`), and every pet gets every tool. Phase 8 moves them into one module with no change in
behaviour:

```text
packages/core/src/tools/
  tool.ts          one Tool shape: id, definition, kind (read | write), run
  registry.ts      toolsFor(pet): the role's tools, filtered by the pet's grants
  builtin/
    perception.ts  look_at_screen, get_selection, list_displays, look_at_display,
                   look_closer, list_windows, read_window_text
    awareness.ts   recall_screen, what_changed, watch_for
    crew.ts        remember, ask_pet
```

The runner asks the registry for a pet's tools and dispatches them one way. An ESLint rule keeps
the runner and engine importing tools only through the registry. Tools that need a login (GitHub,
Notion and others) arrive with Hands: the user connects a service once in Settings, then grants it
per pet as off, ask me, or allowed.
