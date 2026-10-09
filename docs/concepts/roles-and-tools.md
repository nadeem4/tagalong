# Roles, directory and tools

**Status: partly built** for Phase 8 (Roles). The role files, the generated role library, the tier
table and its lookup helpers, [the tools module](#the-tools-module), giving a pet a role, the
directory, filtering a turn's tools by role and grants, [roles over RPC](#roles-over-rpc), the
office's job labels, and picking a role, the recommended model, the tool switches and the directory
card preview, now in each agent's controls in Home (see [Home](../architecture.md#home)),
[the one-time roles notice](#the-roles-notice) for upgraded installs and
[roles in the setup wizard](#roles-in-the-setup-wizard) are **built**. The design page with the full
task list lives in the Notion plan.

## Roles

Every pet has exactly one role. A user who wants more roles creates more pets. Tagalong ships the
roles; custom roles are parked for later, and the file format already allows them.

The first six:

| Role              | Good at                                     | Recommended brain       |
| ----------------- | ------------------------------------------- | ----------------------- |
| Generalist        | Explaining, summarising, answering anything | Balanced                |
| Backend engineer  | APIs, databases, stack traces, CI           | Deep                    |
| Frontend engineer | UI code, CSS, browser bugs, accessibility   | Balanced, sees pictures |
| Writer            | Emails, docs, rewrites, release notes       | Balanced                |
| Researcher        | Reading pages and papers, comparing sources | Deep                    |
| Companion         | Working out what you need, briefing experts | Fast                    |

The Companion never does the work itself. Its tools are only the ones that look (screen, selection,
windows), `remember`, and `hand_to_expert`, which writes a brief and hands it to an expert such as
Claude Code; it has no `ask_pet` and nothing that writes files or runs code.

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
unknown id), `roleFor(id)` (the generalist for an unknown id) and
`recommendedModel(role, providerId)`. `listRoles`, `getRole` and `recommendedModel` are exported from
`@tagalong/core` for hosts.

### Roles over RPC

**Built.** Two host-to-core methods put the library on the wire, so a host never bundles it:

| Method                 | Params                   | Result                                             |
| ---------------------- | ------------------------ | -------------------------------------------------- |
| `roles.list`           | `{}`                     | `{ roles: Role[] }`, the whole library             |
| `roles.recommendModel` | `{ roleId, providerId }` | `{ model?, visionModel? }` from `recommendedModel` |

`roles.recommendModel` answers `{}` for a provider with no tier table, such as `fake`, and refuses an
unknown role with RPC error `-32602` (invalid params). `pets.upsert` refuses a pet whose `roleId` is
not in the library the same way, and saves nothing. A new pet, or one whose role changed, is saved
with that role's library `version` as its `roleVersion`; an existing pet keeping its role keeps the
`roleVersion` it was sent with.

The `HostBridge` in `@tagalong/ui` carries both as `listRoles()` and
`recommendModel(roleId, providerId)`. The desktop wires them through IPC and the preload like
`listPets`; the extension relays them over its port like any other engine call; the fake bridge
takes `roles` and a `recommend` function.

### Job labels in the office

**Built.** Home's agent list labels each pet with its role's name in capitals, looked up in
`listRoles()` by `pet.roleId`; a pet whose role is not in the library reads `GENERALIST`, as it
works. Each label's colour comes from `officeTokens.roleInk`, keyed by role id (generalist teal,
writer violet, backend engineer amber, frontend engineer pink, researcher green), so two pets with
the same role share a colour whatever their ids. A role with no ink of its own uses the muted text
colour.

### What the role decides

**Built.** A pet's role sets two things on every turn:

- **Its instructions.** The system prompt is the base rules, then the role's `instructions`, then
  `Your name is <name>.`, then the pet's `notes` under the heading "The user's notes for you" when
  there are any, then the reply-style rule and the recalled memories as before.
- **Its tools.** `toolsFor` gives the pet exactly the tools its role lists, minus any its
  `toolGrants` set to `off`. A grant cannot add a tool the role does not list.

A pet whose `roleId` is not in the library works as a generalist, for both.

## The directory: how pets know who can do what

**Built**, except the last three card fields, which are still design.

Like colleagues reading a team directory, each pet sees a card for every teammate it can reach. The
cards are one line each in the `ask_pet` tool's description, after the pet's id (what `petId`
takes):

| Card field       | Comes from                                       | Status |
| ---------------- | ------------------------------------------------ | ------ |
| Name             | The pet                                          | Built  |
| Role and summary | The role file                                    | Built  |
| Good at, not for | The role file                                    | Built  |
| Can reach        | The pet's granted tools                          | Design |
| Sees pictures    | The pet's model                                  | Design |
| Brain            | The pet's model: fast, balanced, deep, or custom | Design |

A pet's notes and memories are never on its card.

To decide who to ask, a pet is told, in one short paragraph of the same description, to apply in
order:

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

- **Built:** `roles.recommendModel` answers that lookup over RPC, so a form can prefill the model.
- **Built:** Home's agent controls show each pet's model as **Recommended** when it is the one that lookup gives
  for the pet's role and provider, and **Your choice** otherwise. **Use recommended** sets the
  recommended model and its vision model (clearing the vision model when the recommendation needs
  none). The user can still type or pick any model on the provider's live list.
- **Built:** the setup wizard prefills each pet's recommended model when it moves to a provider (see
  [Roles in the setup wizard](#roles-in-the-setup-wizard)).
- Design from here on. Prefilling the recommended model when a pet is added, and setting a vision
  model automatically when the role needs pictures and the chosen model cannot see.

## What a pet stores

**Built.** The pet is stored as JSON in the `pets` table of `tagalong.db`, validated by the `Pet`
schema in `packages/protocol/src/pet.ts`:

| Field                                              | Change in Phase 8                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `roleId`, `roleVersion`                            | New                                                                                  |
| `toolGrants`                                       | New: tool id → `off` or `allowed`; the default `{}` allows every tool the role lists |
| `toolAllowlist`                                    | Removed: never read                                                                  |
| `persona`                                          | Becomes optional `notes`; a persona the user edited is kept as notes                 |
| `name`, `avatar`, `color`                          | Unchanged                                                                            |
| `providerId`, `model`, `visionModel`, `watchModel` | Unchanged                                                                            |

The default crew ships with roles: Scout is a Generalist, Ink a Writer and Bolt a Backend engineer,
none with notes. Home's agent controls edit the notes as "Notes (optional, private)"; a new pet starts as a
Generalist.

Database migration 5 (`packages/core/src/pets/roles-upgrade.ts`) upgrades pets stored before roles.
For every pet without a `roleId` it:

- gives Scout, Ink and Bolt (by id) their roles above, and any other pet the Generalist role;
- sets `roleVersion` from the role library and `toolGrants` to `{}`;
- drops `toolAllowlist`;
- moves `persona` to `notes`, unless it is blank or is that default pet's shipped persona unchanged.
  A pet the user created always keeps a non-blank persona as notes.

A stored pet that still carries a `persona` or `toolAllowlist` key parses: the schema drops keys it
does not know.

Logins and API keys stay encrypted in `secrets.json`, never in the pet.

### The roles notice

**Built.** An install upgraded to roles is told once what changed, over Home.

- **What is recorded.** Database migration 6 (`packages/core/src/pets/roles-notice.ts`) runs in the
  same `migrate` call as migration 5 and records, in a `notices` table, one row per stored pet:
  `{ petId, name, roleId, keptNotes, madeByYou }`. `keptNotes` is true when migration 5 kept the
  persona as notes; `madeByYou` is true for any pet that is not Scout, Ink or Bolt. A fresh install has
  no pets while the migrations run (the crew is seeded after), so it records nothing and never sees the
  notice. Migration 5 itself was left as shipped, because it had already run on existing databases.
- **Over RPC.** `notices.rolesUpgrade` (`{}` → `{ notice: { pets } | null }`) answers the notice while
  it is unseen; `notices.dismiss` (`{ notice: 'rolesUpgrade' }` → `{ dismissed }`) marks it seen for
  good. The `HostBridge` carries them as `rolesNotice()` and `dismissRolesNotice()`; the desktop wires
  them through IPC and the preload, the extension relays them over its port, and the fake bridge takes
  a `rolesNotice` option.
- **Where it shows.** At launch the desktop opens Home when a notice is pending, and Home
  shows it as a modal dialog: "Your crew has roles now", one sentence, a row per pet (sprite,
  name, arrow, the role in its ink, and "Default persona replaced by the role", "Your edited persona is
  kept as notes" or, for a pet the user made, "Your persona is kept as notes; pick a better role any
  time"), a **What changed?** disclosure, **Review my crew** (opens the first agent's controls in Home) and **Got it**. Either
  button, or Escape, dismisses it.

### Roles in the setup wizard

**Built.** The wizard's **Meet your crew** step shows each pet's role: its name in the role's ink and
its summary. When the provider step is left, the wizard asks `roles.recommendModel` for each pet's role
on every keyed provider. A pet moving to a provider starts on its role's recommended model, with a
**Recommended** chip that goes away once the model is edited; the model stays editable, with the
provider's live list beside it. A pet already on a provider with a key keeps its model, so a rerun of
the wizard does not undo a choice made in Settings. There is no hiring step: the wizard keeps its seven
steps.

## The tools module

**Status: built**, with roles and grants filtering each turn's tools.

All 13 built-in tools live in one module, in one shape, and reach a turn one way:

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
    experts.ts     hand_to_expert
```

- **Kind.** A tool is `write` when it leaves stored state behind after the turn: `remember` files a
  memory, `watch_for` starts a watch, `hand_to_expert` starts a hand-off and remembers which expert
  took that kind of task. The other ten are `read`; `ask_pet` costs a model call but stores nothing.
- **Context.** Every tool runs with the turn's pet, turn id, abort signal, snapshot, whether the
  pet's brain can see, and a counter for nested model calls.
- **Which tools a turn gets.** The registry builds what the engine is wired for, in a fixed order,
  and returns none when the pet's provider cannot call tools. `ask_pet` is left off roundtable
  turns and off a crew of one. `hand_to_expert` is built only when an expert is switched on, and
  lists every such expert and what it is good at in its description. An unknown name is refused by
  name.
- **`toolsFor(pet, tools)`** is the single place a turn's tools are narrowed: the tools the pet's
  role lists, minus any its grants turn off (see [What the role decides](#what-the-role-decides)).

The runner asks the registry for a turn's tools and dispatches through it. An ESLint rule keeps
`conversation/` and `engine.ts` importing tools only from `tools/registry` or the `tools` index,
never from `tools/builtin/*`. To add a built-in, follow the repo skill
`.claude/skills/tagalong-add-tool/SKILL.md`.

Tools that need a login (GitHub, Notion and others) arrive with Hands: the user connects a service
once in Settings, then grants it per pet as off, ask me, or allowed.
