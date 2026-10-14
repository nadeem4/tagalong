# Memory

**Status: built (thread, summaries, memories, screen) + design (vector search).**

Scout remembers what is being said now, what it has learned about you, and, if you turn it on, the
last few minutes of your screen.

## The kinds of memory

| Kind               | Where it lives                                 | Lifetime               | Status |
| ------------------ | ---------------------------------------------- | ---------------------- | ------ |
| **Working**        | The prompt, rebuilt for every turn             | One turn               | Built  |
| **Thread**         | `messages` table, verbatim                     | Until deleted          | Built  |
| **Thread summary** | `memories` table, kind `summary`               | Until deleted          | Built  |
| **Memories**       | `memories` table, kind `fact` or `preference`  | Until deleted          | Built  |
| **Screen**         | RAM in the desktop host, never written to disk | Ten minutes by default | Built  |

Everything except screen memory lives in `tagalong.db`, the local SQLite file in the data
directory (`%APPDATA%\Tagalong` on Windows). Nothing leaves the machine except what a turn sends to
Scout's own model provider.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#000000", "secondaryColor": "#ffffff", "tertiaryColor": "#ffffff", "background": "#ffffff", "clusterBkg": "#ffffff", "clusterBorder": "#000000"}}}%%
flowchart LR
  subgraph Stored["tagalong.db"]
    T["Thread messages"]
    S["Thread summaries"]
    P["Memories"]
  end
  R["Screen frames, RAM only"]
  W["Working memory: one turn's prompt"]
  T -- "last N messages" --> W
  S -- "recall" --> W
  P -- "recall" --> W
  R -. "recall_screen, what_changed, when asked" .-> W
```

## Working memory: building one turn

Every turn is assembled from scratch by the prompt assembler
(`packages/core/src/conversation/prompt-assembler.ts`). Nothing is held between turns.

A turn contains, in order:

1. The base instructions, the role's instructions, Scout's name and your notes for it (see
   [roles-and-tools.md](roles-and-tools.md)).
2. Recalled memories, within a budget (below).
3. The thread: the last `historyMessages` messages of this conversation.
4. The context you attached: selection, window, screenshot, page text.

## Recall: which memories ride along

Built in `packages/core/src/memory/recall.ts`:

- The **5 newest** memories, then **up to 5 more** that match the question.
- Matching is SQLite FTS5 full-text search, ranked by BM25. Every word of the question is quoted
  and OR-ed, so punctuation in a question can never break the query.
- The total is capped at **2,000 characters**. Whole memories are dropped from the end rather than
  cut mid-sentence.
- Visibility is decided in SQL on every read: `scope = 'crew' OR pet_id = <this pet>`. The `crew`
  scope value is a leftover name for a shared memory; with one companion it changes nothing.

Scout files a memory with the `remember` tool (`{ text, kind: fact | preference }`), so "I prefer
short answers" is kept across restarts.

## Summarising long threads

Built in `packages/core/src/memory/summarizer.ts`. When 20 unsummarised messages build up, they
are folded into one paragraph of at most 1,000 characters; the newest 4 messages are left alone.
Summarising runs after a turn and never blocks one, uses the model chosen in Settings → Advanced →
Summaries (Same as Scout by default), and gives up after a minute to try again next turn.

## Vector search (design: built only after measuring)

Keyword search misses paraphrases: "the CI problem" will not find "the build was failing". The
plan is embeddings in `tagalong.db` through `sqlite-vec`, merged with keyword matches by reciprocal
rank fusion. It is built only when a recall test set shows keyword search failing.

## Screen memory

Built in the desktop host (`apps/desktop/src/main/awareness/`), off by default (Settings → Privacy →
**Remember the last few minutes of the screen**):

- One small frame per display every five seconds, kept in RAM for the last ten minutes (1 to 30).
- Never written to disk. Pausing sight or quitting throws it away; blind spots are never recorded.
- A red dot shows on Scout while it records.
- Scout reads it back with `recall_screen` and `what_changed` when you ask about something seen
  earlier or what changed.
