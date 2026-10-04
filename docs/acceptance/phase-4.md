# Phase 4: Crew — acceptance

Run on **2026-10-04** in a Linux build container (Node 22, pnpm 10.34.5), not on the Windows desktop
the app targets. Branch `phase/4-crew`, stacked on `phase/6-browser-host`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

No model provider was called to produce this record. Every test ran on the fake provider or on a
scripted `BrainProvider` in the test itself; no API key exists in this container.

Phase 3 (Voice) is not built in this project (owner decision "Hackathon build scope"), so every
voice-related item in the phase page was built and checked as text only.

## Checks

| Command                                          | Result                                                       |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm lint`                                      | ✅ exit 0                                                    |
| `pnpm format:check`                              | ✅ exit 0                                                    |
| `pnpm typecheck`                                 | ✅ exit 0                                                    |
| `pnpm test`                                      | ✅ 87 files, 1,098 tests passed (3 skipped), exit 0          |
| `pnpm --filter @tagalong/extension build`        | ✅ built                                                     |
| `electron-vite build` (apps/desktop)             | ✅ main, preload and the three renderer pages bundle         |
| Electron launch under Xvfb (Playwright, fake AI) | ❌ no window within 15 s on Linux; see Notion issue, not run |

## Coverage

`pnpm test:coverage` over `packages/core/src` and `packages/protocol/src`.

| Metric     | Threshold | Phase 6 | Phase 4    |
| ---------- | --------- | ------- | ---------- |
| Statements | 70%       | 93.97%  | **94.69%** |
| Branches   | 70%       | 84.96%  | **84.48%** |
| Functions  | 70%       | 96.59%  | **97.12%** |
| Lines      | 70%       | 94.99%  | **95.73%** |

New core modules: `crew/roundtable.ts` 100% lines, `crew/commands.ts` 100%, `crew/consult.ts` 93.2%,
`crew/handoff.ts` 92.9%, `memory/memories.ts` 100%, `memory/recall.ts` 100%,
`memory/summarizer.ts` 94.7%, `conversation/crew-tools.ts` 100%.

## Acceptance script

- [~] **Ask Scout to explain a page, then type `@Ink draft a reply to this`. Ink answers with the
  context intact.** Verified end to end over the real websocket with a recording provider
  (`engine.test.ts`, "hands Scout's thread to Ink"): the second ask carries Scout's conversation id,
  core broadcasts `pet.message { kind: 'handoff' }`, Ink starts in a new conversation on
  `anthropic/claude-sonnet-5`, and the request Ink's model receives contains Scout's question and the
  user's request. `crew/handoff.test.ts` checks the payload: two-paragraph summary, latest snapshot,
  request. Whether a live Ink draft is _good_ needs a real model — feature test 4.6.
- [~] **Ask Bolt a question that needs writing polish. Bolt consults Ink and the answer shows the
  consult card.** `crew/consult.test.ts`: Bolt's scripted brain calls `ask_pet`, Ink's turn runs on
  Ink's own provider and model, the reply returns as the tool result, `pet.message { kind: 'consult' }`
  is tied to Bolt's turn, and `modelCalls` is 3. `chat-panel-crew.test.tsx` renders the card above the
  answer and the "3 model calls" footer. Whether a live Bolt _chooses_ to consult needs a real model —
  feature test 4.8.
- [~] **Run a roundtable on a design question. Three distinct voices take turns and a synthesis ends
  it.** Text only (no Phase 3). `crew/roundtable.test.ts` and the RPC test in `engine.test.ts`: `/crew`
  runs Ink → Bolt → Scout → Ink-synthesis with each turn on its own provider and model, round markers
  precede the turns, `crew.status` ends `done` with 4 model calls. The UI test renders round dividers,
  `Name · model` labels per speaker, Stop, and the counter. Live run with mixed providers — feature
  tests 4.10 and 4.13.
- [~] **Tell Scout you prefer short answers. Restart the app. Scout still keeps answers short.**
  `engine.test.ts` "remembers a stated preference after the engine restarts": "I prefer short
  answers." is filed as a private preference, the engine is shut down and rebooted on the same data
  dir, and the next ask's system prompt carries it under "What you remember". That the live model then
  _answers_ short — feature test 4.14.
- [x] **Tests cover registry CRUD, recall ranking, handoff payload, consult depth limit and timeout,
      and roundtable ordering.** `pets/registry.test.ts`, `engine.test.ts` (pets over RPC, including a
      delete that survives restart), `memory/memories.test.ts`, `memory/recall.test.ts`,
      `crew/handoff.test.ts`, `crew/consult.test.ts` (nested consult refused; a 20 ms timeout returns an
      error result and the caller still answers), `crew/roundtable.test.ts` (order, round limit of 3,
      stop, interrupt, a failing pet).

## Tasks

- **44 — registry, default crew, `pets.*`.** `[x]` A fresh database seeds Scout, Ink and Bolt; upsert
  and delete round-trip through RPC; a deleted default stays deleted across restart (`pet_seeds`).
- **45 — memories with scopes and FTS5.** `[x]` Private and shared memories stored and searchable;
  another pet's private memories are never returned, in `recent` or `search`.
- **46 — recall in `PromptAssembler`.** `[x]` Five recent plus up to five FTS matches, deduplicated,
  under 2,000 characters; the section is capped at 2,000 characters including its heading. Writers:
  the `remember` tool and the stated-preference net.
- **47 — summarization job.** `[x]` After 20 messages a summary memory exists and the next request
  sends 5 messages instead of 19. The model is `settings.summarizer`, defaulting to the pet's own
  provider and model (the phase page named `claude-haiku-4-5`; see Notion Decisions).
- **48 — handoff.** `[x]` Payload contains summary, snapshot and request; the target answers in a new
  conversation; the UI shows the bubble, moves to the target, and offers the Hand off menu.
- **49 — `ask_pet`.** `[x]` Nested consult refused; timeout returns an error result to the caller.
- **50 — roundtable.** `[x]` Turn order and round limit tested; stop and interrupt cancel the rest.
- **51 — crew strip, switcher, editor, voice alternation.** `[~]` Strip, switcher, editor, hidden pets
  and counter are built and unit-tested and the desktop bundles, but nothing was seen on a Windows
  desktop. **Per-pet voice alternation is deferred to Phase 3** (Notion Issues). Left _In progress_.
- **52 — this record.** `[x]` Plus README "The crew", `docs/architecture.md` "The crew (Phase 4)",
  and the Phase 4 section of `docs/testing/feature-test-guide.md`.

## Needs a human run

Use [the feature test guide](../testing/feature-test-guide.md), section "Phase 4: Crew".

- [ ] 4.1–4.3 on Windows: three avatars dock as one strip, move together, and clicking one opens the
      panel on that pet.
- [ ] 4.6 with OpenRouter + Claude: Ink's draft uses the page Scout explained.
- [ ] 4.8–4.9: Bolt consults Ink (card, "3 model calls"); a failing consult does not break Bolt.
- [ ] 4.10–4.12: `/crew`, Stop and the Crew button with OpenRouter + Claude.
- [ ] 4.13: the mixed roundtable — Nemotron 3 Super, Nemotron Nano 2 VL and Claude via OpenRouter —
      with each answer labelled by model; confirm the Nemotron Nano and OpenRouter Claude ids against
      the live lists.
- [ ] 4.14–4.16: memory across a restart, shared vs private memories, the summary row in SQLite.
- [ ] 4.17–4.19: summarizer setting, pet editor, add / hide / delete pets.
- [ ] 4.20: the same crew features in the Chrome side panel.
- [ ] The Electron smoke suite on Windows.
- [ ] Voice alternation in a roundtable — when Phase 3 lands.
