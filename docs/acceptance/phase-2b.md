# Phase 2B: Full View — acceptance

Run on **2026-09-20**, Windows 11 Home 10.0.26200, Node 22.17.0, pnpm 10.34.5, from
`C:\projects\ai_pet`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

Every command below ran with fake providers. No Anthropic, OpenAI or ElevenLabs call was made
to produce this record, which is why the items that turn on a model's judgement are handed to
the human rather than ticked.

## Checks

| Command                                  | Result                                     |
| ---------------------------------------- | ------------------------------------------ |
| `pnpm lint`                              | ✅ exit 0                                  |
| `pnpm format:check`                      | ✅ exit 0                                  |
| `pnpm typecheck`                         | ✅ exit 0                                  |
| `pnpm build`                             | ✅ exit 0                                  |
| `pnpm test`                              | ✅ 61 files, 787 tests passed, exit 0      |
| `npx playwright test` (apps/desktop) × 3 | ✅ 12 passed, exit 0 — 20.3s, 19.7s, 19.2s |

Three Playwright runs, not one, for the reason Phase 2 gave and this phase enlarged: the suite
launches real Electron apps, asks Windows for real displays and real windows, and spawns real
PowerShell. A single green run cannot tell a stable pass from a lucky one. It now launches a
**second** app in an isolated user-data directory for the hotkey recovery spec, so a boot
failure in one cannot be hidden by the other's state.

## Coverage

`pnpm test:coverage`, v8 provider, over `packages/core/src` and `packages/protocol/src` — the
hosts are covered by the Playwright suite instead, so they carry no bar.

| Metric     | Threshold | Phase 2          | Phase 2B             |
| ---------- | --------- | ---------------- | -------------------- |
| Statements | 70%       | 93.30% (599/642) | **93.34%** (813/871) |
| Branches   | 70%       | 78.96% (229/290) | **82.92%** (403/486) |
| Functions  | 70%       | 94.19% (146/155) | **94.97%** (189/199) |
| Lines      | 70%       | 93.96% (561/597) | **94.14%** (756/803) |

All four rose while the covered surface grew by 229 statements — 36% more code, better covered
than before. Branches gained the most (+3.96 points), which is where the phase's refusal paths
live: paused, excluded, unreadable, no source, no display.

## Acceptance script

From the Phase 2B page, as amended.

- [ ] **With three monitors, press the see-everything hotkey and ask what is on my right
      monitor. The pet uses `look_at_display` or reads the composite and answers correctly.**
      Needs a human run, and needs a real key. Everything up to the model is verified: the
      Playwright test _a full-view capture returns every real display and a composite_ proves a
      real capture returns real per-display PNGs and a composite from the running app, and
      `composite.test.ts` (10 tests) proves the layout puts each monitor where its geometry
      says. Whether the pet then _answers correctly_ is the model's, and the fake provider
      cannot stand in for it.
- [ ] **Ask what does the error in the terminal on the left say. The answer quotes the exact
      text via `read_window_text`.** Needs a human run with a real key, for the same reason —
      and note the honest limit below. A terminal that paints its own text publishes little or
      nothing to UI Automation; on this machine a minimized editor returned 456 characters, its
      menus rather than its file. The read path itself is covered by `window-text.test.ts` (31
      tests) and `text-layer.test.ts` (11).
- [~] **Press the pause hotkey. Every capture is refused and the avatar shows paused.** The
  refusal half is verified in the running app: the Playwright test _pausing sight refuses a
  real capture, and resuming restores it_ drives pause through the host API and asserts a
  real capture comes back refused, then works again. `sight-gate.test.ts` (12 tests) proves
  every method that reads the screen is gated, and the coverage is a mapped type over
  `keyof Platform`, so a new adapter method that has not decided what pause does to it does
  not compile. The grey eye has its own tests in `pet-avatar.test.tsx`. **The hotkey
  physically firing and the tray item being clicked are not verified** — see below.
- [ ] **Focus a password manager. That display is blanked in the composite and in its own
      image, it is marked `blocked` in `list_windows`, and `read_window_text` on it refuses.**
      Needs a human run: it needs a real password manager focused. The logic is not taken on
      trust — `displays.test.ts` (17 tests) covers blanking including the case that matters
      most, a display blanked for an excluded window that is **not** the focused one;
      `inventory.test.ts` (28) covers the `blocked` marking; and the refusal before any text is
      read has its own test. `packages/protocol/src/settings.test.ts` still asserts the shipped
      defaults contain `1Password.exe`, `Bitwarden.exe`, `KeePass.exe`, `KeePassXC.exe` and
      `CredentialUIBroker.exe`.
- [ ] **Without touching it, ask what is in the editor window behind this one. The answer
      quotes text fetched by `read_window_text`, with no screenshot of it.** Needs a human run
      with a real key. That a background window _can_ be read was measured directly during the
      phase — a background browser window returned 34,588 characters — and the round trip is
      covered by `full-view-tools.test.ts` (31 tests) against a fake host and by the Playwright
      test _a tool call travels the real socket and the real host answers it_ against the real
      one. Whether the pet _chooses_ to reach for it is the model's.
- [ ] **Minimize a window and ask what it is. The pet names it from `list_windows`, reads what
      UIA exposes, and says plainly what it cannot see inside.** Needs a human run with a real
      key. This is the item most worth running carefully, because it is where the pet is most
      likely to overclaim. The code does its part: a thin read carries a note that the window
      published little, and that note lives in its own protocol field rather than being
      prefixed onto the text, so the pet cannot quote a caveat back as screen content.
- [ ] **Ask about a browser tab you are not currently on. The pet says that needs the Phase 6
      extension instead of guessing.** Needs a human run with a real key. Chromium windows are
      marked `browser: true` in the inventory and a read of one carries the note that other
      tabs need the browser host, which is the next phase. Whether the pet _says so_ rather
      than guessing is the model's.
- [x] **Tests pass; `docs/acceptance/phase-2b.md` is written from a real run.** 787 unit tests
      and 12 Playwright tests, three consecutive green Playwright runs, and this record written
      from those runs.

## Where the acceptance clause's named coverage lives

The task's acceptance names six areas. Each has real tests, counted here so a reader does not
have to take the claim on trust:

| Named area                               | Where                                                                | Tests |
| ---------------------------------------- | -------------------------------------------------------------------- | ----- |
| Composite layout                         | `platform/composite.test.ts`                                         | 10    |
| Crop math                                | `platform/region.test.ts`                                            | 8     |
| Exclusion blanking                       | `platform/displays.test.ts`                                          | 17    |
| Window inventory shape                   | `core/perception/inventory.test.ts`, `platform/window-list.test.ts`  | 28+28 |
| Per-window text caps, truncation marking | `platform/window-text.test.ts`, `core/perception/text-layer.test.ts` | 31+11 |
| Helper parser tests                      | `platform/window-list.test.ts`, `platform/window-helper.test.ts`     | 28+18 |

And the four paths the clause asks the Playwright suite to drive through the real app:

| Path            | Playwright test                                                       |
| --------------- | --------------------------------------------------------------------- |
| See-everything  | _a full-view capture returns every real display and a composite_      |
| Pause gate      | _pausing sight refuses a real capture, and resuming restores it_      |
| Tool seam       | _a tool call travels the real socket and the real host answers it_    |
| Hotkey recovery | `hotkey-recovery.spec.ts`, 4 tests in an isolated user-data directory |

## What the tests caught

Phase 2's record has a section on what its smoke test caught — one bug. This phase's equivalent
is not one bug but a pattern, and it is the most useful thing the phase produced.

**Six times, a fully green unit suite sat on top of a feature that did not work at all.**

| #   | What was dead                                                   | Unit suite at the time | What caught it     |
| --- | --------------------------------------------------------------- | ---------------------- | ------------------ |
| 1   | The PowerShell transport — enumeration returned nothing, exit 0 | 516 green              | a real-desktop run |
| 2   | The first detector, guarding the mechanism not the call site    | 620 green              | mutation by hand   |
| 3   | `capturePatch` never handled the `displays` target              | 663 green              | a new smoke test   |
| 4   | `HostSession` missing `listWindows` and `captureRegion`         | 710 green              | a new smoke test   |
| 5   | The pause gate never wired into `start()`                       | 761 green              | a new smoke test   |
| 6   | Saving a hotkey never re-registered it                          | 780 green              | a new smoke test   |

A seventh was found by reading rather than running: the settings form sent
`hotkeys: { ask, look }`, and because a patch replaces the whole object, **every save silently
deleted the two new bindings**. It parsed cleanly, warned about nothing, and was invisible only
because no UI had existed to rebind what it removed.

**None of these could have been caught by a unit test, and the reason is the same each time.**
Every unit test in this codebase injects its dependency — a fake capturer, a fake registrar, a
fake platform, a fake host — and then exercises the thing it injected. That is correct, it is
what makes the suite fast and display-free, and it means a unit test proves the _logic_ and can
never prove the _wiring_. Items 3 through 6 each had thorough, passing unit tests for the exact
behaviour that was broken in the running app.

Item 5 is the one worth remembering. Removing `gateSight` from `start()` left all 761 unit tests
green while the pause control did nothing: the hotkey toggled, the tray showed checked, the
avatar eye went grey, and every capture still ran. **A privacy control that reports itself as on
while doing nothing is a worse failure than one that is obviously broken**, because the user
relies on it precisely when it matters.

The rule the phase converged on, and the one to carry into Phase 6:

> **If a check cannot fail when the application is broken, it is not a check.**

Verifying the script proves nothing about the transport carrying it. Verifying the transport
proves nothing about which arguments the application passes. A duplicated constant beside a
comment promising it is kept in step by hand is that promise failing quietly.

The working practice that came out of it, used on every task from 5 onwards: **before claiming
a feature works, break it at the real call site and confirm something goes red.** If nothing
does, the missing test is found before the merge rather than three tasks later.

## Deviations from the phase page

| Phase page said                                                            | What shipped                                                                                        | Why                                                                                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Composite is "at most 1568 wide"                                           | The **long side** is bounded, through the existing `fitWithin`                                      | A vertical monitor stack is tall rather than wide; a width-only bound would let it grow without limit.                                                                         |
| A bundled PowerShell helper script                                         | The script is a string, sent with `-EncodedCommand`                                                 | A bundled `.ps1` must survive electron-vite, asar and the installer — each a way to work in dev and be silently empty when packaged. Stdin was tried first and was the bug.    |
| `read_screen_text(scope)` with a `focusedWindow` / `display` / `all` scope | `read_window_text(windowId?, maxChars?)`, one window per call, no `all` scope, its absence asserted | Measured on a twelve-window desktop, `all` is 46,491 characters — about 11,600 tokens — in one call, 34,588 of them from a single background browser window.                   |
| Nine tasks, no window inventory                                            | A tenth task added at Order 3 — the inventory — and the text layer moved ahead of the hotkey        | The inventory is what answers "which window should this go to" for about 300 tokens, and it is what the per-display exclusion fix needed. Reordered so the hotkey followed it. |
| An excluded **focused** app blanks its display                             | A display blanks when **any non-minimized window on it** is excluded                                | Phase 2 only ever framed the focused window, so an unfocused password manager was never in frame. Capturing every display puts it in frame; the old check was insufficient.    |
| The context chip lists each display's **focused app**                      | It lists the apps **open** on that display                                                          | Windows has one foreground window for the whole desktop, so an unfocused display has no focused app — the field does not exist for exactly the displays being described.       |
| `look_closer` crops the captured display                                   | It re-captures that display at **full resolution**, then crops                                      | Cropping a 1568px thumbnail of a 4K monitor returns the blur the pet leaned in to escape.                                                                                      |
| (not addressed)                                                            | A stored accelerator that cannot register **does not stop the app booting**                         | The settings editor is the only way to store one, so refusing to start locks the user out of the window that could fix it, with the settings file the only way back.           |
| The inventory budget was set at 300 tokens                                 | Raised to 400, still asserted on a twelve-window fixture; measured 311                              | Task 4's character counts add a field to every line. Raised once, deliberately, with the test still enforcing it, rather than widened quietly mid-task.                        |
| Step 5 includes an OCR fallback                                            | **Deferred — not built.** See below.                                                                | `look_closer` covers the same windows without OCR's recognition errors in exactly the code and identifiers where a wrong answer is worse than no answer.                       |

## OCR is deferred, not done

Task 7 is marked `[DEFERRED 2026-09-20]` on the board rather than closed, and this record does
not claim it.

**Why it was planned.** The text layer only returns what an app publishes to the accessibility
tree. Measured on this machine: a background browser window gave 34,588 characters and Explorer
1,449, but a **minimized editor gave 456** — its menus, not the file — and a second browser gave
**22**. Editors, terminals, design tools, remote desktop sessions and PDF viewers paint their own
text and expose little or nothing.

**Why it is not needed yet.** `look_closer` reaches those windows already, by capturing the
display at full resolution and handing the crop to the vision model. OCR's only real advantage
was cost — free and local against roughly 1,500 tokens for an image — and it buys that with
recognition errors (`rn` for `m`, `l` for `1`) in precisely the content worth reading.

**What reopening takes.** Nothing structural. `read_window_text` emits `source: 'uia'` only, and
`source: 'ocr'` remains in the protocol enum, unused. The decision reopens if real use shows
`look_closer` being reached for often enough that the token cost bites.

**What neither path solves.** A minimized window that publishes no text has no pixels to
photograph either. The pet can name it and say it cannot read inside it. That is the honest
limit of this phase, and the record should not imply otherwise.

## Needs a human run

Each needs a real desktop. The six model-judgement items also need a real Anthropic key saved
through Settings with the provider set to `anthropic`, and `TAGALONG_FAKE_PROVIDERS` **must not**
be set in that session. The fake provider returns scripted text that cannot satisfy any of them,
and no agent run of this repo may spend the user's tokens to try.

1. **The see-everything hotkey.** Press `Ctrl+Shift+Alt+S`. Expect the panel to open with a chip
   naming each screen by the number drawn in the corner of the composite. Then ask "what is on my
   right monitor". Expect an answer about that monitor's actual contents.
2. **Read a window you are not looking at.** Leave an editor or a document open **behind** the
   window you are using, or minimized. Ask "what is in the VS Code window behind this one".
   Expect the pet to fetch it with `read_window_text` — the panel shows the tool request — and
   quote real text, with no screenshot taken of it.
3. **The overclaim check.** Minimize an editor with a file open and ask what is in it. Expect the
   pet to **name the window and say it cannot read inside it**. If it confidently describes file
   contents, that is the failure this phase most wants to hear about: the notes are reaching the
   model but not changing what it says.
4. **A browser tab you are not on.** Ask about a tab that is open but not focused. Expect the pet
   to say that needs the browser extension, not to guess. That extension is the next phase.
5. **Pause.** Press `Ctrl+Shift+Alt+P`. Expect the avatar eye to go grey. Press
   `Ctrl+Shift+Alt+S` and expect the capture refused with a note that says sight is off — **not**
   that the app is excluded, and not an empty answer. Press pause again and confirm it comes
   back. Then do the same from the tray's **Pause sight** item.
6. **A password manager.** Open 1Password, Bitwarden or KeePassXC and give it focus. Press
   `Ctrl+Shift+Alt+S`. Expect that display blanked in its own image **and in the composite**,
   the window marked blocked in the inventory, and a read of it refused. Then repeat with the
   password manager **visible on a second monitor but not focused** — that is the case Phase 2
   would have missed and this phase fixed.
7. **Rebind a hotkey.** Open Settings, change `Ctrl+Shift+Alt+S` to something else, save, and
   press the new key **without restarting**. Expect it to work immediately. Then deliberately
   bind one to something another app already holds, save, and restart: expect the app to **still
   start**, with the other hotkeys working and a message naming the binding that failed.
8. **Cost.** A full-view capture is roughly 3,200 input tokens and takes a few seconds, most of
   it counting characters in every window. If that feels slow, the levers are the per-window text
   budget in Settings, or dropping the counts from the default capture.
9. **CI.** Confirm the run on `main` is green and record the run id here.

## Open items for the human

1. **Run the nine items above** and tick the acceptance script from the results. Items 1–4 and 6
   are the ones a fake provider genuinely cannot stand in for.
2. **Add an Anthropic API key** through Settings first. Phase 0 task 2 — creating the keys and
   storing them in `.env.local` — is still open and is what blocks them.
3. **Phase 2's four unticked items are still unticked.** They were deferred by choice when 2B
   started, not resolved, and are still in `docs/acceptance/phase-2.md`.
4. **Decide whether the counting cost is acceptable** before Phase 6 adds the browser host on
   top of it. The measurement is in the deviations table; the levers are in Settings.
