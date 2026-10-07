# Context isolation

**Status: design.** The private-memory rule (enforced in SQL) is built today; the rest arrives with
the Meetings phase.

The promise: **a pet knows only what it was told, in places it was present.** It remembers meetings
it attended, like a real colleague; it cannot see meetings it was not in, and two meetings running
at the same time cannot see each other.

## Why this is enforceable

A pet holds nothing between turns (see [pet-communication.md](pet-communication.md)). Everything it
knows on a turn was put into that turn's prompt by one function, the prompt assembler. So isolation
is a property of **what the assembler is allowed to load**, and that can be tested.

## The turn scope

Every turn is built for exactly one scope:

```ts
interface TurnScope {
  petId: string;
  threadId: string; // the conversation or meeting this turn belongs to
}
```

From that scope, the assembler may load only:

| Source            | Rule                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Thread messages   | `thread_id = scope.threadId`                                                               |
| Personal memories | `scope = 'pet' AND pet_id = scope.petId`                                                   |
| Shared notebook   | `scope = 'crew'`                                                                           |
| Minutes           | the minutes row lists `scope.petId` as an attendee                                         |
| Directory         | pets in the same groups as `scope.petId`: role cards only, never their memories or threads |
| Screen memory     | never automatically; only through a tool call, which is shown to the user                  |

Each rule is a `WHERE` clause in the query, not a filter applied afterwards, so there is no code
path that loads something and forgets to drop it. A final check rejects any loaded message whose
`threadId` is not the scope's, and fails the turn loudly rather than send it.

## The ways context could leak, and the guard for each

| Leak                                               | Guard                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A meeting's messages appear in another meeting     | Thread rule above, plus the final `threadId` check                                            |
| A pet sees a meeting it never attended             | Minutes are visible only to attendees; transcripts only by `threadId`                         |
| A pet is in two meetings at once and mixes them    | The per-pet lock: one room at a time (see [meetings.md](meetings.md))                         |
| A pet repeats what it heard in an earlier meeting  | **Allowed by design**, like a colleague. It happens in a visible message, so the user sees it |
| A pet writes something to the shared notebook      | The write is a tool call that appears in the thread, so it is never silent                    |
| A quick question carries the asker's meeting along | The asked pet gets only the question text, no thread, no tools                                |
| Screen memory reaches a pet unasked                | Only via `recall_screen` / `what_changed`, shown in the panel, refused while sight is paused  |
| A tool result from one meeting reaches another     | Tool results are messages in their thread, under the same rules                               |

## What crosses between meetings, and how

Information moves only through steps the user can see:

1. **A pet's own memory.** It attended both; it may bring up what it learned. Visible as its
   message.
2. **Minutes and task results.** A meeting's outcome goes back to whoever asked for it.
3. **The shared notebook.** Written by a visible tool call, read by everyone.
4. **A quick question at a desk.** Shown in the panel.

There is no other route, because there is no other way into a prompt.

## Tests that prove it

The isolation rules ship with tests, run in CI:

- Two meetings run concurrently with different pets and a planted unique phrase in each; neither
  meeting's prompts ever contain the other's phrase.
- A pet that did not attend a meeting never receives its minutes or messages, through any tool.
- A pet in a meeting cannot be added to a second live meeting.
- A quick question's prompt contains only the question.
- The assembler throws when handed a message from another thread.
