# Phase 2: Sight — acceptance

Run on **2026-09-11**, Windows 11 Home 10.0.26200, Node 22.17.0, pnpm 10.34.5, from `C:\ai_pet`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

Every command below ran with `TAGALONG_FAKE_PROVIDERS=1`. No Anthropic, OpenAI or ElevenLabs
call was made to produce this record, which is why four of the five acceptance items are
handed to the human rather than ticked.

## Checks

| Command                                  | Result                                 |
| ---------------------------------------- | -------------------------------------- |
| `pnpm lint`                              | ✅ exit 0                              |
| `pnpm format:check`                      | ✅ exit 0                              |
| `pnpm typecheck`                         | ✅ exit 0                              |
| `pnpm build`                             | ✅ exit 0                              |
| `pnpm test`                              | ✅ 40 files, 369 tests passed, exit 0  |
| `npx playwright test` (apps/desktop) × 3 | ✅ 3 passed, exit 0 — 4.4s, 2.7s, 2.4s |

Three Playwright runs, not one: the suite launches a real Electron app and asks the real
`desktopCapturer` for pixels, so a single green run would not tell a stable pass from a lucky
one. A fourth run happened before these three and failed — see _What the smoke test caught_.

## Coverage

`pnpm test:coverage`, v8 provider, over `packages/core/src` and `packages/protocol/src` — the
hosts are covered by the Playwright smoke test instead, so they carry no bar.

| Metric     | Threshold | Measured             |
| ---------- | --------- | -------------------- |
| Statements | 70%       | **93.30%** (599/642) |
| Branches   | 70%       | **78.96%** (229/290) |
| Functions  | 70%       | **94.19%** (146/155) |
| Lines      | 70%       | **93.96%** (561/597) |

All four rose against Phase 1 (92.06 / 75.98 / 93.23 / 92.56) while the covered surface grew
by 100 statements, so the perception code arrived with its own tests rather than diluting them.

## Acceptance script

- [ ] **Open a chart or an error dialog, press Ctrl+Shift+S, ask what is wrong here. The
      answer references specific on-screen text.** Needs a human run. The fake provider
      answers from a script that never looks at the image, so no run of this repo's tests can
      show an answer referencing the screen. What is verified here is everything up to the
      model: the smoke test proves a real capture returns a real PNG, and
      `packages/core/src/conversation/runner.test.ts` proves the image is placed in the user
      message before the question.
- [ ] **Ask what does this button do with nothing selected. The pet uses `look_at_screen` on
      its own and answers.** Needs a human run: whether a model _chooses_ to call the tool is
      a property of the model, not of this code. The round trip once it chooses is covered —
      13 tests in `packages/core/src/perception/tools.test.ts` drive `look_at_screen` and
      `get_selection` against a fake host, including the no-vision, excluded-window,
      no-capable-host and host-failure paths.
- [ ] **Focus a password manager window and press Ctrl+Shift+S. Capture is refused with a
      visible note.** Needs a human run — it needs a real password manager focused. The
      matching itself is not taken on trust: 11 tests in
      `packages/core/src/perception/exclusions.test.ts` cover process-name folding and the
      anchored title globs, and `packages/protocol/src/settings.test.ts` asserts the shipped
      defaults really contain `1Password.exe`, `Bitwarden.exe`, `KeePass.exe`, `KeePassXC.exe`
      and `CredentialUIBroker.exe`, plus the `*Bitwarden*` and `*Windows Security*` patterns.
      The refusal note has its own test in `packages/ui/src/sight-bar.test.tsx` ("says capture
      is blocked here rather than showing nothing").
- [ ] **The eye badge appears on every capture.** Needs a human run — it needs eyes on a
      screen for one second. Its logic is unit tested with fake timers in
      `packages/ui/src/pet-avatar.test.tsx`: the badge is absent before a capture, present for
      exactly one second after one, and appears again on every later capture. Seven more tests
      in `apps/desktop/src/main/capture-notice.test.ts` cover the tray tooltip wording.
- [x] **Tests cover downscaling, exclusion matching, and the tool round trip with a fake
      host.** All three, and they run in `pnpm test` above: downscaling in
      `apps/desktop/src/main/platform/downscale.test.ts` (6 tests — aspect ratio both ways,
      the exact-bound case, never upscaling, rounding, and the one-pixel sliver) and
      `platform/capture.test.ts` (8 tests, including that the bound is pushed into the
      capturer request rather than applied after it); exclusion matching in
      `packages/core/src/perception/exclusions.test.ts` (11 tests); the tool round trip in
      `packages/core/src/perception/tools.test.ts` (13 tests against a fake host).

## What the smoke test proves

The Playwright suite gained a third test, `capture takes a real, downscaled PNG of the
screen`. It is the only check in the repo where `desktopCapturer.getSources` actually runs —
every unit test injects a fake capturer — and it deliberately refuses to settle for "a string
came back":

- [x] A real `perception.capture` over IPC returns a screenshot, driven through
      `window.tagalong.capture(['screenshot', 'activeWindow'])` rather than the global hotkey,
      which needs focus no CI desktop can promise.
- [x] The base64 is non-empty and its **decoded bytes start with `89 50 4E 47`**, the PNG
      signature. An empty buffer, a scripted stub or a JPEG all fail this.
- [x] Width and height are positive and the long side is **at most 1568**, so the downscale
      demonstrably applied in the running app and not only in `fitWithin`'s unit tests.

The decode happens inside the page, not in the test process: a 1568px PNG is megabytes of
base64, and shipping all of it across the CDP connection to read four bytes is waste. As in
Phase 1, no transient UI state is asserted — no streaming bubble, no one-second badge. Those
live in the unit tests that own fake timers.

## What the smoke test caught

The first run of the new assertion failed, and it was not the test's fault.

`captureActiveWindowImageWith` returned `null` the moment `getActiveWindow()` did, before ever
asking the capturer for anything. On this machine `get-windows` reports no foreground window
at all — verified directly, outside Electron — while the capturer happily listed 15 usable
windows and 2 usable screens. Windows answers with no foreground window more often than it
sounds: a locked or disconnected session, a UAC prompt on the secure desktop, a full-screen
exclusive game. In every one of those the pet was silently blind, with nothing in the UI to
say why.

It also contradicted the rule one layer above it. `findCaptureBlock` deliberately **allows** a
window it cannot name, on the stated reasoning that refusing everything unidentifiable is a pet
that never sees — and then the capture refused anyway.

Fixed test-first: a failing case in `platform/capture.test.ts`, then `pickSource` widened to
accept a null active window, skipping the window enumeration and falling back to the first
usable screen with a `maxLongSide × maxLongSide` thumbnail box. `null` is still returned when
nothing is capturable at all. The README privacy section records the fallback. Logged in
[Tagalong Issues](https://app.notion.com/p/fbe46b28758244c586dde6f27f9696ac).

## Needs a human run

Each of these needs a real desktop session, and the first two also need a real Anthropic key
saved through Settings with the provider set to `anthropic`. The fake provider returns scripted
text that cannot satisfy any of them, and no agent run of this repo may spend the user's tokens
to try.

1. **The answer references on-screen text.** Open something with legible text on it — a chart
   with axis labels, an error dialog, a failing build log. Press `Ctrl+Shift+S`. The panel
   opens with a thumbnail in the sight bar. Type "what is wrong here" and press Enter. Expect
   an answer that quotes or names text that is actually on that screen, not a generic
   description.
2. **The pet reaches for `look_at_screen` itself.** Select nothing. Open the panel with
   `Ctrl+Shift+Space` (the text-only hotkey, so no screenshot is attached), and ask "what does
   this button do". Expect the pet to call `look_at_screen` on its own — the panel shows the
   tool request — and then answer about the button. If it answers "I cannot see your screen",
   the tool is not reaching the model: check that the provider advertises tool support.
3. **A password manager refuses capture.** Open 1Password, Bitwarden or KeePassXC and give it
   focus. Press `Ctrl+Shift+S`. Expect the panel to open with a visible note that capture is
   blocked here, naming the exclusion entry that refused it, and **no** thumbnail. Repeat with
   a Windows credential prompt ("Windows Security") if one is convenient to trigger.
4. **The eye badge appears on every capture.** Watch the avatar, not the panel. Press
   `Ctrl+Shift+S`, then press it again a few seconds later, then use the Look button in the
   composer. Expect the eye badge on the avatar for about a second on each of the three, and
   the tray tooltip to read that Tagalong captured the screen at that time.
5. **CI.** Confirm the run on the pushed branch is green and record the run id here.

## Deviations from the phase page

| Phase page said                                                                                          | What shipped                                                                                        | Why                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 4 registers `look_at_screen` and assumes it works, saying nothing about the tool-result contract    | `BrainContent`'s `tool_result.content` widened from `string` to `string \| BrainContentBlock[]`     | A tool that returns pixels cannot answer with prose. The widening is provider-neutral — a block array, not Anthropic's wire format — and `string` stays for the common case so no existing call site had to change.                          |
| Step 9 says the panel "warns" when the provider has no vision, with no notification to carry the warning | `turn.warning` added to the protocol catalog, first user `code: "vision_unsupported"`               | The catalog had only `turn.error`, which ends a turn. A host that aborted on it would throw away a perfectly good answer. `turn.warning` is shaped like `turn.error` so a host renders both with the same code, in a quieter colour.         |
| Step 8 says screenshots are not persisted by default                                                     | They were being written to the database anyway; the image is now stripped before the row is written | The default alone does nothing — `mayPersistScreenshot` now gates the stored snapshot, `withoutScreenshot` strips the image, and `purgeExpiredScreenshots` sweeps on every turn so switching retention off clears the past as well.          |
| Step 1 falls back to "the display containing the active window"                                          | Also falls back to a screen when there is **no** identifiable active window                         | Found by this acceptance run: with no foreground window the capture bailed before asking the capturer, so the whole feature was dead on any session where Windows reports none. See _What the smoke test caught_.                            |
| Step 1 says to test capture "with a fixture window in the smoke test"                                    | The smoke test captures the real desktop through the host API, with no fixture window               | A fixture window would only prove the capturer can photograph a window this suite made. Asserting the PNG signature and the 1568 bound on a real capture proves the same path with nothing staged, and keeps the suite to one launch a file. |

## Open items for the human

1. **Run the four unticked acceptance items above**, in that order, and tick them here. They
   are the only parts of Phase 2 that a fake provider cannot stand in for.
2. **Add an Anthropic API key** through Settings before items 1 and 2 — vision needs a real
   model, and `TAGALONG_FAKE_PROVIDERS=1` must not be set in that session.
3. **Decide whether the no-foreground-window fallback is the privacy behaviour you want.** It
   follows the rule `findCaptureBlock` already states — an unnameable window is allowed — but it
   does mean that in a session where Windows names nothing, a capture photographs a whole
   screen. The conservative alternative is to refuse and say so in the sight bar. Worth a row
   in `Tagalong Decisions` either way.
4. **`productName` is still unset** in `apps/desktop/package.json`, carried over from Phase 1.
   Changing it after release strands every existing user's settings, secrets and database.
