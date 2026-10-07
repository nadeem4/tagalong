---
name: tagalong-add-tool
description: Use when adding or changing a built-in tool a Tagalong pet can call (anything in packages/core/src/tools/builtin) - before writing its definition, its run function, its test, or registering it.
---

# Adding a built-in tool

## Overview

Every built-in tool is one `Tool` in `packages/core/src/tools/builtin/`, and reaches a turn only
through `ToolRegistry` in `tools/registry.ts`. The runner never knows a tool by name.

**Core principle: one shape, one registry, one dispatch.** A tool that needs a special case in the
runner is a tool in the wrong shape.

## Where it goes

| The tool is about                     | File                      |
| ------------------------------------- | ------------------------- |
| What is on screen now                 | `builtin/perception.ts`   |
| The screen over time: recall, watches | `builtin/awareness.ts`    |
| The crew: memory, other pets          | `builtin/crew.ts`         |
| None of these                         | a new `builtin/<area>.ts` |

Helper code that exists only for the tool lives in the same file. Code with other users (exclusions,
inventory, the watch manager, the memory store) stays in its own folder and is imported.

## The shape

```ts
export const LOOK_AT_THING = 'look_at_thing'; // the name the model sees, exported

const DEFINITION: BrainTool = { name: LOOK_AT_THING, description: '...', inputSchema: { ... } };

export function lookAtThingTool(deps: Deps): Tool {
  return defineTool(DEFINITION, 'read', async (input, ctx) => {
    // input is unknown: validate it, and answer a bad one with { content, isError: true }
    // ctx: pet, turnId, signal, snapshot, vision, countCall
    return { content: '...' };
  });
}
```

- **Use `defineTool`**, so the id can never drift from the definition's name.
- **Never throw.** A host that fails or a bad input becomes `{ content, isError: true }` the model can
  repeat to the user. A throw ends the whole turn.
- **Pixels only with `vision`.** When `ctx.vision` is false, say in words what was captured and that
  the pet could not see it.
- **Read the description as the model will.** It is the tool's only documentation for the model; say
  when to use it and what is cheaper.

## Read or write

`write` when running it leaves stored state behind after the turn (a memory filed, a watch started).
Everything else is `read`, even when it costs a model call. Decide by the state, not by how risky it
feels: Phase 8 grants lean on this.

## Test it first, with fakes

Write the failing test in `builtin/<area>.test.ts` before the tool. No real host, no real provider:

```ts
const tools = fakeTurnTools({ perception: { hosts: () => [fakeHost], exclusions: () => NONE } });
const outcome = await tools.run({ name: LOOK_AT_THING, input: { id: 1 } });
```

`fakeTurnTools` and `fakeTurn` (in `tools/fake-turn.ts`) give a turn with a stub pet; pass
`{ vision: true }` and the like as overrides. A fake host is a plain object with `capabilities` and the
methods the tool calls. Cover: the happy path, bad input, no host that can do it, a host that
rejects, and the blind path if it returns pixels. Use `FakeBrainProvider` for anything that needs a
model, never a real one.

## Register it

1. Add it to `ToolRegistry`'s list in `tools/registry.ts` (`#all`), behind the dependency it needs.
   Append; the order is what the model has always seen.
2. Export its name from `tools/index.ts`, and from `src/index.ts` if a host needs it.
3. Update `registry.test.ts`: the full list of names and the write list.
4. New wiring (a new dependency) goes through `ToolRegistryOptions` and the runner's options. Never
   import `tools/builtin/*` from `conversation/` or `engine.ts`: ESLint refuses it.

Filtering per pet happens only in `toolsFor` (Phase 8 roles). Do not add an `if` for one pet
anywhere else.

## Docs

Update `docs/concepts/roles-and-tools.md` (the tools module list), the tool's section of
`docs/architecture.md`, and `README.md` if users will notice. Docs are part of done.

## Red flags

- A tool name in `runner.ts`
- `throw` inside a `run`
- Returning image blocks without checking `ctx.vision`
- A test that needs a real screen, a real socket or a real API key
- An import from `tools/builtin/` outside `tools/`
