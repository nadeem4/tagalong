# Phase H: Hackathon (Nemotron on Token Factory, OpenRouter preset) — acceptance

Run on **2026-10-04** in a Linux build container (Node 22.22.0, pnpm 10.34.5), not on the Windows
desktop the app targets.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

No OpenRouter, Token Factory or Anthropic call was made to produce this record. There is no key
in the build container, and its network blocks both services. Everything below ran on fake
`fetch` streams or the fake provider. Items that need a real model are handed to the human.

## Checks

| Command                              | Result                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| `pnpm lint`                          | ✅ exit 0                                                      |
| `pnpm format:check`                  | ✅ exit 0                                                      |
| `pnpm typecheck`                     | ✅ exit 0                                                      |
| `pnpm test`                          | ✅ 65 files, 879 tests passed (3 skipped), exit 0              |
| `electron-vite build` (apps/desktop) | ✅ bundles; `pnpm build` cannot fetch the Electron binary here |
| `npx playwright test` (apps/desktop) | not run: needs Windows and the Electron binary; CI runs it     |

## Coverage

`pnpm test:coverage` over `packages/core/src` and `packages/protocol/src`.

| Metric     | Threshold | Phase 2B | Phase H    |
| ---------- | --------- | -------- | ---------- |
| Statements | 70%       | 93.34%   | **93.73%** |
| Branches   | 70%       | 82.92%   | **84.43%** |
| Functions  | 70%       | 94.97%   | **96.40%** |
| Lines      | 70%       | 94.14%   | **94.86%** |

## TAG-92 — OpenAiCompatibleProvider

- [x] Chat-completions wire format with a configurable base URL, defaulting to Token Factory
- [x] Streams text deltas; ignores reasoning deltas; survives SSE comment lines (OpenRouter)
- [x] Assembles streamed tool calls and round-trips tool_use / tool_result
- [x] Images inside tool results go in a user message after the tool messages
- [x] Finish reasons (`length`, `content_filter`) and usage mapped; HTTP errors and abort mapped
- [x] Registered as `nebius`, and as the `openrouter` preset
- [x] No network in tests: the SDK parses canned SSE from a fake `fetch`

## TAG-93 — per-pet provider and model, vision routing

- [x] Each pet's `providerId` picks its provider; a missing key fails only that pet's turn
- [x] A turn with an image goes to the pet's vision model when its model cannot see,
      including an image a tool returns mid-turn
- [x] A pet with no model that can see never sends pixels (screenshot dropped with a warning,
      tool images replaced by a note)
- [x] On OpenRouter every model sees, so a Claude pet uses one model for everything
- [x] Fresh-install Scout defaults to Nemotron 3 Super with Nemotron Nano 2 VL
- [~] Settings window edits a pet's provider, model and vision model — builders tested;
  the window itself needs a Windows run

## TAG-94 — keys, settings, model list

- [x] `NEBIUS_API_KEY` and `OPENROUTER_API_KEY` stored through SecretStore, one entry each
- [x] Base URL overrides per preset in settings; documented in `.env.example` and the README
- [x] `models.list` answers from `GET /models`, with the built-in list when there is no key, in
      fake mode, or when the service cannot be reached
- [~] Settings window shows key boxes, base URL boxes and the model picker — needs a Windows run

## Needs a human run

- [ ] OpenRouter + a Claude model: text answer, a look (`Ctrl+Shift+S`), and a `look_closer`
      tool call that returns an image the answer then describes
- [ ] Token Factory + Nemotron 3 Super: text answer and a tool call; a look routes to Nemotron
      Nano 2 VL
- [ ] Confirm `nvidia/Nemotron-Nano-V2-12b` against Token Factory's `GET /v1/models` and the
      OpenRouter fallback ids against OpenRouter's; correct the constants if they differ
- [ ] The settings window on Windows: save a key, reopen, see "one is stored" and the live list
- [ ] The Electron smoke suite on Windows (CI runs it on the PR)
