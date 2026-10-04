# Phase 3B: Awareness — acceptance

Run on **2026-10-04** in a Linux build container (Node 22, pnpm 10.34.5), not on the Windows desktop
the app targets. Branch `phase/3b-awareness`, stacked on `phase/4-crew`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

No model provider was called to produce this record. Every test ran on the fake provider, on a
scripted `BrainProvider` standing in for the watch check model, or on a fake host; no API key exists
in this container. Every timing rule ran under a fake clock.

Phase 3 (Voice) is not built in this project (owner decision "Hackathon build scope"). A watch that
fires is therefore **shown, not spoken**: a card in the panel, a system notification and an alert on
the pet's avatar. Spoken watch alerts are logged in Notion Issues as deferred to Phase 3.

## Checks

| Command                                         | Result                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint`                                     | ✅ exit 0                                                   |
| `pnpm format:check`                             | ✅ exit 0                                                   |
| `pnpm typecheck`                                | ✅ exit 0                                                   |
| `pnpm test`                                     | ✅ 98 files, 1,240 tests passed (3 skipped), exit 0         |
| `pnpm --filter @tagalong/extension build`       | ✅ built                                                    |
| `electron-vite build` (apps/desktop)            | ✅ main, preload and the three renderer pages bundle        |
| Electron launch on Windows with a real provider | ❌ not possible here (Linux, no keys) — _Needs a human run_ |

Phase 4 ended at 87 files and 1,098 tests; this phase adds 11 test files and 142 tests.

## Coverage

`pnpm test:coverage` over `packages/core/src` and `packages/protocol/src`.

| Metric     | Threshold | Phase 4 | Phase 3B   |
| ---------- | --------- | ------- | ---------- |
| Statements | 70%       | 94.69%  | **93.70%** |
| Branches   | 70%       | 84.48%  | **82.62%** |
| Functions  | 70%       | 97.12%  | **96.11%** |
| Lines      | 70%       | 95.73%  | **95.06%** |

New core modules: `perception/recall-tools.ts` 96% lines, `watch/watch-manager.ts` 90%,
`watch/watch-tool.ts` 82%, `providers/watch-models.ts` 100%. The desktop modules
(`apps/desktop/src/main/awareness/`) are outside the coverage set; their suites are listed under task 90.

## Acceptance script

- [~] **With rolling memory on, ask what was I reading five minutes ago. The pet answers from
  `recall_screen` and names the time it is describing.** Verified without a screen or a model:
  `rolling-memory.test.ts` records a moment every 5 s from a fake platform under a fake clock;
  `perception-memory.test.ts` answers `perception.recall { secondsAgo: 300 }` with the frame from five
  minutes before and its `capturedAt`; `runner-awareness.test.ts` runs a turn whose brain calls
  `recall_screen`, and the tool result is an image block followed by text carrying that timestamp and
  "5 minutes ago"; `recall-tools.test.ts` checks the tool description tells the pet to state the time.
  A live pet naming the page and the time — feature test 3B.3.
- [~] **Start a long command and ask tell me when this finishes. The watch fires within 10 seconds of
  completion after only a handful of Haiku checks, and the pet speaks the result.** Under a fake
  clock (`watch-manager.test.ts`): a change that settles is checked once and fires within ten seconds;
  a screen that keeps changing is not checked until it stops; a "no" moves the baseline so a still
  screen is never re-checked; the 60-check and 3-watch caps, the timeout and Stop all end the watch.
  `engine.test.ts` starts a watch from a `watch_for` tool call over the real websocket, sees
  `watch.status`, and stops it with `watch.stop`. The check model is the pet provider's small model
  (Claude Haiku on OpenRouter and Anthropic, Nemotron 3 Nano on Token Factory), not only Haiku — see
  Notion Decisions. **Not spoken**: Phase 3 is not built; the result is shown as a card, a toast and
  an avatar alert. Live run — feature tests 3B.10 and 3B.16.
- [~] **Press the pause hotkey. Recording stops and the avatar dot disappears; resume brings it
  back.** `rolling-memory.test.ts`: `pauseChanged(true)` stops the timer, clears the ring and reports
  `recording: false`; resuming reports `true` and records again. `pet-avatar.test.tsx`: the red dot
  shows while recording and never while sight is paused. The desktop wiring (pause → controller →
  IPC → avatar) is built but was not seen on Windows — feature test 3B.8.
- [~] **Quit and restart. The buffer is empty; a recall asks for nothing older than the restart.**
  The ring has no persistence at all and a test asserts no awareness module imports `fs`;
  `dispose()` on quit clears it; a recall of 600 s on a fresh buffer answers with the oldest frame and
  the tool says how far back memory reaches. A real quit and restart — feature test 3B.9.
- [~] **Tests pass; `docs/acceptance/phase-3b.md` is written from a real run.** Tests pass, above.
  This record is from the container run; the Windows run with a real provider is the owner's.

## Tasks

- **87 — protocol.** `[x]` `perception.recall`, `perception.diff`, `watch.fired`, plus `watch.status`
  and `watch.stop` (Notion Decisions), each with valid and invalid cases in `awareness.test.ts`;
  `HostCapability` accepts `recall`. Protocol 0.3.0. Settings gain `rollingMemory` and `watch`, pets
  gain `watchModel`. **Done.**
- **81 — rolling memory.** `[~]` Ring eviction past the configured minutes, skipped frames for an
  excluded focused app and while paused, clear on pause, off and quit, no disk access — all unit
  tested with a fake clock. The recording dot is a `PetAvatar` prop with a component test. Not seen on
  Windows. Left _In progress_.
- **88 — `recall_screen` and `what_changed`.** `[x]` Runner tests with a fake host show both tools
  calling their perception method and returning image blocks with the frame timestamps in text.
  **Done.**
- **82 — watch mode.** `[~]` Poll, settle rule, one check per change, caps, timeout, Stop, the
  Watching chip with its check model, the fired card, toast and avatar alert — all built and tested.
  **Spoken alert deferred to Phase 3.** Not run on Windows or against a live model. Left _In progress_.
- **89 — settings and privacy.** `[~]` Awareness section and per-pet watch check model in Settings;
  the patch builders are tested; rolling memory reconfigures on save and a watch limit saved over RPC
  applies to the next watch (`engine.test.ts`); README privacy section updated. The settings window
  itself was not opened on Windows. Left _In progress_.
- **85 — image token estimate.** `[x]` The sight bar shows width × height ÷ 750 summed over every
  attached image; `sight-bar.test.tsx` covers one and three images. **Done.**
- **90 — tests and this record.** `[~]` `frame-ring.test.ts` (eviction), `pixel-diff.test.ts` (diff
  ratio), `watch-manager.test.ts` (fake clock, scripted check model), `recall-tools.test.ts` and
  `runner-awareness.test.ts` (both tools through the runner) all pass. A real run with a spoken watch
  cannot happen until Phase 3. Left _In progress_.

## Needs a human run

Use [the feature test guide](../testing/feature-test-guide.md), section "Phase 3B: Awareness".

- [ ] 3B.1–3B.2: the Awareness settings on Windows; the red dot appears on save, no restart.
- [ ] 3B.3: "what was I reading five minutes ago?" on OpenRouter + Claude names the page and the time.
- [ ] 3B.4–3B.7: memory reach, memory off, `what_changed`, and an excluded app never recorded.
- [ ] 3B.8–3B.9: pause clears and hides the dot; quit and restart starts empty.
- [ ] 3B.10–3B.15: a watch fires within 10 s of a command finishing after a handful of checks on
      `anthropic/claude-haiku-4.5`; Stop, the three-watch cap, timeout, check cap, per-pet check model.
- [ ] 3B.16: a watch on Token Factory with Nemotron 3 Nano as the check model; confirm the Nano id
      against the live model list.
- [ ] 3B.17: the image token estimate in the sight bar.
- [ ] The watch threshold (0.5% of the region) and the 24-level pixel tolerance on real screens: a
      blinking cursor must not trigger a check, a new terminal line must.
- [ ] The Electron smoke suite on Windows.
- [ ] Spoken watch alerts — when Phase 3 lands.
