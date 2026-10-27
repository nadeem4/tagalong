# Brain tools (row 7): design

Status: approved in chat 2026-10-27; builder check done, awaiting doc approval.

## Intent

Scout should work like a Jarvis: one assistant that can use every hand it has, whether that hand lives in the
brain, in a body (desktop, extension) or, later, in a connected app or an expert. Today the brain offers the
model only its three memory tools; the desktop declares window tools but the brain never offers them, `use` is
never sent and `call` answers `method_not_found`.

The user decides what Scout may do without asking. Every tool has a permission, **ask** or **auto**, that the
user controls, the way coding agents handle tool permissions.

This row builds the tool framework, not every tool. A new kind of tool (MCP in row 9, experts in row 8) is a new
_source_ plugged into the same toolbox; the thinking loop does not change.

## Goals

- One toolbox: a single list of tools the model sees, rebuilt every step from the sources online right now.
- One dispatcher with one policy gate that every call goes through, from the model or from Home.
- Body tools offered to Scout as `<body id>__<name>`, run on the owning body with `use`, with offline, timeout
  and cancel handled.
- A per-tool permission (ask / auto), stored in the brain, with sensible defaults, changeable from Home.
- Asks for permission shown on every connected body: Allow once, Always allow, Deny.
- Home reads and changes brain state through `call`: memories, today's spend, the permission list; `changed`
  tells bodies to refetch.

## Non-goals (this row)

- MCP connected apps (row 9) and experts (row 8). The source interface must make them a drop-in, nothing more.
- Model-worded asks with free options (non-confirm asks). Only permission asks are built.
- Live-state replay after `resync` beyond what an open ask needs (see Asks).
- Settings other than permissions (model choice, voice, budget limit) through the brain.
- A risk classifier. A tool's effect comes from its declaration, not from guessing at its name.

## Anti-goals

- Scout approving its own ask, or changing its own permissions. Only a person's click approves; the permission
  tools are Home-only.
- A tool running with no gate check. There is no second path.
- Offering the model a tool whose body is offline.
- Asking so often Scout is useless: reads and Scout's own memory run without asking by default.

## Shape

```
            +----------- Toolbox -----------+
 model <--> | one list, rebuilt every step  |
 Home  <--> | one dispatcher + policy gate  |
            +---+-----------+-----------+---+
                |           |           |
           brain tools  body tools   (later) MCP, experts
```

### Tool spec

One record per tool, whatever the source:

| Field                         | Meaning                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `name`                        | full model-facing name (`recall`, `desktop__list_windows`)                   |
| `description`, `input_schema` | as the model sees them                                                       |
| `effect`                      | `read` (leaves no state behind) or `change`                                  |
| `for`                         | `scout`, `home` or both: who may run it                                      |
| `default_mode`                | `auto` or `ask`; when absent, `read` gives `auto` and `change` gives `ask`   |
| `locked`                      | always ask, the user cannot set it to auto (body tools with `confirm: true`) |

### Sources

A source is anything that can (a) list its tool specs right now and (b) run one by name. Two sources in this
row:

- **Brain source**: the brain's own tools (`tools.py`). Memory tools `remember`, `recall`, `forget` are `for:
scout` (and `forget` also `home`) with `default_mode: auto`, since remembering is how Scout keeps up (my
  call). Home tools listed below.
- **Body source**: one per online body. Lists that body's declared tools with the `<body id>__` prefix; runs a
  call by sending `use` with the plain name to that body's current connection and waiting for its response.

The toolbox asks every source for its list at each model step, so a body that goes offline mid-turn drops out
of the next step. A full name longer than 64 characters (the model API's limit) is dropped and logged.

### Policy gate

Every call, in this order:

1. Unknown name, or `for` does not include the caller: `unknown_tool`.
2. Body source and the body is offline: `body_offline`.
3. Caller is Scout and the tool's mode is `ask` (or it is `locked`): open a permission ask and wait (below).
   Calls from Home skip this step: the Home click is the person acting.
4. Run, bounded by a timeout: `use` 30 s, brain tools none. Past it: `timeout`, and the brain sends the body a
   `cancel` for that call.

Errors reach the model as tool results with `is_error`, worded so it knows _why_ (denied, offline, timed out)
and can say so or try another way. Later rules (jobs get read tools only, spend caps per tool) are new checks
in this one gate.

### Permissions

- Stored in `~/.tagalong/tagalong.db`, a `permissions` table keyed by full tool name, mode `ask` | `auto`. A
  tool with no row uses its default. Unknown body tools without `effect` count as `change`, so they ask.
- Contract change (additive, v1): `Tool` gains optional `effect: "read" | "change"`. The desktop marks
  `list_windows`, `read_window_text` and `look_at_window` as `read`. Python and zod schemas and the examples
  change together.
- Turning a `locked` tool to auto is refused (`invalid_params`).

### Asks

- Built on the contract's confirm ask. Options are `["allow", "always", "deny"]`, or `["allow", "deny"]` for a
  `locked` tool. Contract change: the confirm rule accepts both lists.
- `text` is the model's own words from the step that made the call (contract rule, no template). If the step
  has no text, `text` is empty and the body shows the tool and its input, as the contract already says. The
  prompt gains one line telling Scout that its words before a call are what the user sees on an ask (my call).
  Several calls in one step share that text.
- `always` saves `auto` for that tool, then runs it. `deny` fails the call with `denied`.
- No answer in 5 minutes: closed with `timeout`, call fails with `timeout`. Turn cancelled: ask closed with
  `cancelled`. No body online when the ask opens: the call fails at once with `denied` and a message saying
  nobody was there to ask.
- Several calls in one step may each ask; asks are independent.
- An open ask is re-sent after `resync` (contract Replay rule), so a reconnecting body still shows it.
- The desktop shows the ask in Scout's bubble with the options as buttons and answers with `answer`. Reuse the
  existing bubble and confirm UI in `bodies/ui` where it fits, per DESIGN.md.

### Home through the brain

- The `hello` result lists the brain tools with `for: home` as plain contract `Tool` records (name,
  description, input_schema, effect). `for`, mode and `locked` stay internal to the brain and are not wire
  fields; bodies learn modes and locks only from `list_permissions` (my call).
- `call` runs a `for: home` brain tool through the gate. Results are one text part holding JSON.
- Home tools: `list_memories`, `forget`, `spend_today` (spent and limit from the budget), `list_permissions`
  (every known tool: name, effect, mode, locked, whether its body is online), `set_permission`.
- After `remember`, `forget` or `set_permission`, the brain sends `changed` with `what` = `memory` or
  `permissions`. Bodies refetch through `call`.
- The desktop's Home memory and usage screens switch from the old `packages/core` engine to brain `call`s, and
  Home settings gains a Permissions list (tool, what it does, Ask/Auto switch; locked tools show as Ask, fixed).

## Slices

| Slice | PR contents                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7a    | Toolbox, sources, gate steps 1, 2 and 4; body tools offered to Scout; `use`, its cancel on turn cancel and timeout, `body_offline` on disconnect; per-step tool list in the turn loop |
| 7b    | Permissions: `effect` contract change, permissions table and defaults, gate step 3, asks and `answer`, desktop ask buttons                                                            |
| 7c    | Home through the brain: brain tools in `hello`, `call`, Home tools, `changed`, desktop Home memory and usage on the brain, Permissions list                                           |

Each slice updates docs/brain.md, protocol/README.md where the contract changes, docs/desktop.md for desktop
work, and docs/testing/feature-test-guide.md.

## Decided

- Permission is per tool, ask or auto, user-controlled (user).
- Allow once / Always allow / Deny on asks; always is saved and changeable from Home (user agreed).
- Reads and Scout's memory default to auto; changes and undeclared tools default to ask (my call, user agreed).
- 30 s `use` timeout, 5 min ask timeout, 64-char name cap, JSON-in-text for `call` results (my calls).

## Left to the builder

- Module layout (suggested: `toolbox.py` for specs, sources and gate; `permissions.py` for the store).
- How `run_turn` takes the per-step list (a callable is enough).
- The pending-`use` table and how a response is matched to its call.
- Exact JSON shapes of the Home tool results, documented in docs/brain.md.
