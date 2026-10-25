# Principles

The rules the Python-brain rewrite follows: who does what, what code decides versus what the model decides, and what we refuse to carry over. The wire details are in [../protocol/README.md](../protocol/README.md).

## Architecture: one brain, many bodies

| Part  | What it is                                                                         | Examples                                                                                                      |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Body  | Where you talk to Scout. Brings its own senses and tools.                          | Windows desktop (screen, pointer, mic, speaker, bubble), Chrome extension (tabs), later phone and a desk body |
| Brain | Decides, remembers, routes. Python. Runs anywhere: laptop, Raspberry Pi, Mac mini. | Thinking loop, sessions, memory, scheduler, guardrails, experts                                               |
| Tools | Do things. Live in the brain, on bodies, or outside.                               | Brain: memory, schedule, settings. Bodies: see screen, point, notify. Outside: MCP apps, Claude Code          |

## Rules

1. Bodies only talk to the brain, never to each other. The brain routes everything.
2. The body you are talking to answers. Other bodies work behind the scenes as internal experts.
3. A turn the brain starts itself (a routine, an expert finishing) is shown on the body you last talked to if it is online, otherwise any online body; every body still gets the notifications.
4. One session across bodies. Start on the phone, carry on at the desk; a second body joins the same conversation.
5. Scout's tool list is what is connected now: brain tools, tools of the bodies online, and MCP apps. The model sees body tools as `<body id>__<name>` (`desktop__see_screen`) so two bodies never collide.
6. Model decides, code guards.

## Code versus model

| Code (the harness)                                                                                                         | Model (intelligence)                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Connect bodies: contract, who is online, delivery, outbox and replay                                                       | Whether to act at all                                                 |
| Thinking loop: build the prompt (soul, relevant memories, now, conversation), call Claude, run tools, stream the reply     | What to say and how                                                   |
| Sessions: one conversation across bodies, compaction when long (compaction summaries are the one place code writes memory) | When to speak, and on which body                                      |
| Memory: store what the model chooses to save, search, chat history                                                         | What is worth remembering                                             |
| Chances to think: clock ticks (including times the model scheduled), events (expert finished, body online, body events)    | Whether a moment deserves a word or silence                           |
| Guardrails: tools that declare `confirm` always ask first; budget; step cap; tool timeouts; secrets hidden                 | Which tool or body to use; asking about anything else it is unsure of |
| Tool routing, experts (launch, track, finish = event), logs                                                                | How important something is                                            |
| Body reflexes: voice start and stop, talk key, stop speaking when interrupted                                              | Everything once hand-coded: check-ins, greetings, routines, nudges    |

Never-do is enforced by absence: if no body offers a tool (for example mouse control), Scout cannot use it. Excluded windows are checked on the body, the only place that can see them.

## No technical debt

- The brain is written fresh with TDD. The old core and its tests are not ported or used as a spec.
- Fresh contract, fresh database, empty memory. No migration of old data.
- The desktop and extension keep their senses; every screen, IPC module and setting for a feature that is not built is deleted, not hidden. Electron stops starting the engine.
- Docs, repo skills and CI are rewritten for the new layout; nothing describes code that no longer exists.
- Never overengineer. Single user for now: no TLS, pairing or multi-user work.
