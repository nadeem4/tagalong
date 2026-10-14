# Concepts

How Tagalong's companion remembers and what it may use. These pages describe the model behind
the code; [../architecture.md](../architecture.md) describes how the engine and its hosts are built
today.

Each page starts with a status line:

- **Built**: matches the code on `main`.
- **Design**: agreed, not built yet.

| Page                                  | Status         | Covers                                                         |
| ------------------------------------- | -------------- | -------------------------------------------------------------- |
| [Memory](memory.md)                   | Built + design | Threads, summaries, memories, recall, screen memory            |
| [Roles and tools](roles-and-tools.md) | Built          | The companion's role file, the model it uses, the tools module |

## The model in one paragraph

Tagalong is one companion, Scout, that sits beside the person's work. Scout sees what they are
doing, answers small things itself, and briefs an expert such as Claude Code for the real work. All
of it runs inside the engine on the user's machine, and nothing is shared that the user cannot see.
