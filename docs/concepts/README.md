# Concepts

How Tagalong's pets remember, meet and talk to each other. These pages describe the model behind
the code; [../architecture.md](../architecture.md) describes how the engine and its hosts are built
today.

Each page starts with a status line:

- **Built**: matches the code on `main`.
- **Design**: agreed, not built yet. The page is updated to match the code when its phase ships.

| Page                                             | Status         | Covers                                                                  |
| ------------------------------------------------ | -------------- | ----------------------------------------------------------------------- |
| [Memory](memory.md)                              | Built + design | The kinds of memory a pet has, summarising, recall, vector search       |
| [Meetings](meetings.md)                          | Design         | Meeting rooms, how a meeting starts, runs and ends, joining as the user |
| [Pet communication](pet-communication.md)        | Design         | Quick questions vs meetings, the message envelope, how hosts are told   |
| [Context isolation](context-isolation.md)        | Design         | What each turn can see, and the guards that stop context leaking        |
| [Roles, directory and tools](roles-and-tools.md) | Design         | Role files, how pets choose who to ask, the tools module, model per pet |

## The model in one paragraph

Tagalong is a simulated office. Pets are colleagues: each has one role, a desk, and its own memory.
When pets need to talk something through they book a meeting room; when they need to do the work
they go back to their desks. A pet remembers what it was told in meetings it attended, like a real
colleague, and nothing else. All of it runs inside the engine on the user's machine: pets never
talk to each other directly, and nothing is shared that the user cannot see in the panel.
