# Phase 7: Polish and Cross-platform — acceptance (hackathon build)

Run on **2026-10-04** in a Linux build container (Node 22.22.0, pnpm 10.34.5), not on the Windows
desktop the app targets. Branch `phase/7-polish-hackathon`, stacked on `phase/3b-awareness`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

**Scope.** Only tasks 69 (onboarding wizard) and 71 (electron-builder packaging) are in this build,
by owner decision ("Hackathon build scope" in Notion Decisions). Tasks 67 (macOS), 68 (Linux), 70
(complete settings, export and delete), 72 (cost dashboard), 73 (watch mode decision; Phase 3B already
built watches) and 74 (release checklist) are untouched and Not started.

No model provider was called to produce this record. There is no API key in this container; every
test ran on the fake provider or on pure functions.

## Checks

| Command                                                    | Result                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                | ✅ exit 0                                                                                   |
| `pnpm format:check`                                        | ✅ exit 0                                                                                   |
| `pnpm typecheck`                                           | ✅ exit 0                                                                                   |
| `pnpm test`                                                | ✅ 103 files, 1,289 tests passed (3 skipped), exit 0                                        |
| `pnpm build`                                               | ✅ every package, the extension, and four renderer pages including `onboarding.html`        |
| `electron-builder --linux dir`                             | ✅ packaged; every `.node` in `app.asar.unpacked`; extension in `resources/extension`       |
| better-sqlite3 inside the packaged Electron 44             | ✅ `new Database(':memory:')` from `resources/app.asar` → SQLite 3.53.4, ABI 149            |
| `pnpm package:win` (cross-built under Wine 9)              | ✅ `Tagalong-Setup-0.0.0-x64.exe`, 126 MB, with the win32 natives and the extension         |
| `playwright test` (smoke suite, including the wizard test) | ❌ cannot launch here: no Linux platform adapter (task 68) — _Needs a human run_ on Windows |

Phase 3B ended at 98 files and 1,240 tests; this phase adds 5 test files and 49 tests.

## Coverage

`pnpm test:coverage` over `packages/core/src` and `packages/protocol/src`.

| Metric     | Threshold | Phase 3B | Phase 7    |
| ---------- | --------- | -------- | ---------- |
| Statements | 70%       | 93.70%   | **93.73%** |
| Branches   | 70%       | 82.62%   | **82.72%** |
| Functions  | 70%       | 96.11%   | **96.15%** |
| Lines      | 70%       | 95.06%   | **95.08%** |

New core module: `providers/key-resolver.ts`, covered by `key-resolver.test.ts` (6 tests).

## Phase acceptance script

- [~] **A fresh Windows machine installs from the NSIS installer and completes onboarding without
  touching a terminal.** The per-user NSIS installer builds (cross-built here under Wine; the canonical
  build is `pnpm package:win` on Windows). The wizard opens on a fresh profile
  (`onboarding.test.ts#shouldOpenOnboarding`), will not leave the provider step without a key
  (`onboarding-flow.test.ts#providerStepProblem`), and a key saved while the app runs is used by the
  next ask (`key-resolver.test.ts`), so no restart is in the path. The real install and first answer —
  feature tests 7.14 and 7.10.
- [ ] **On macOS, Phase 1 to 3 acceptance scripts pass after granting permissions.** Not in this build
      (task 67).
- [ ] **Cost dashboard shows today's usage per pet.** Not in this build (task 72).
- [ ] **Export data produces a zip with the SQLite file and settings without secrets.** Not in this
      build (task 70).

## Tasks

### 69. UI: onboarding wizard — _In progress_

Acceptance: "Fresh install reaches a first answer without a terminal."

- [x] Seven steps: welcome and the privacy promise; provider (OpenRouter, Nebius Token Factory,
      Anthropic) and key, with a link to each key page through main's allowlist (`links.test.ts`); crew
      models for Scout, Ink and Bolt from the live `models.list`; the four hotkeys and the crew syntax;
      optional rolling memory; Chrome extension folder and pairing token; finish on a first question.
- [x] Skippable from every step; re-openable from the tray (**Setup wizard**) and from Settings (**Run
      the setup wizard again**). `onboarding.done` in settings (`settings.test.ts#Settings.onboarding`).
- [x] Crew picks: Nemotron Super gets Nano 2 VL as its vision model, Claude drops a Token Factory one,
      a watch model is dropped on a provider change (`onboarding.test.ts#applyCrewChoice`); a rerun keeps a
      pet on a keyed provider (`onboarding-flow.test.ts#initialCrewPicks`).
- [x] A key pasted in the wizard answers the next question without a restart (`key-resolver.test.ts`).
- [~] Electron smoke test `the setup wizard opens on request, insists on a key, and Skip closes it for
good` written; it runs on Windows only. Feature tests 7.1–7.12 by hand.

### 71. Desktop: electron-builder packaging — _In progress_

Acceptance: "Installers build in CI artifacts; native modules load in the packaged app."

- [x] `apps/desktop/electron-builder.json`: per-user x64 NSIS (no admin, choice of folder, shortcuts,
      run after finish), asar with `**/*.node` unpacked, `npmRebuild: false`, `publish: null`, the built
      extension in `resources/extension`. Checked as data by `packaging.test.ts`.
- [x] `pnpm package:win` (root and desktop); `scripts/fetch-native.mjs` downloads get-windows' win32
      N-API binary first, because pnpm skips its install script.
- [x] better-sqlite3 loads from the packaged app on Electron 44 (Linux package, this container).
- [ ] Installers as CI artifacts. The branch could not change `.github/workflows/ci.yml` (the push was
      refused: the app that pushes has no `workflows` permission), so the steps are below for the owner to
      add. CI runs on pull requests to `main` only, so they first run once this stack is retargeted.
- [~] dmg, AppImage and deb are configured, not verified (and the app has no macOS or Linux adapter).
- [ ] Native modules in the installed Windows app — feature test 7.15.

## Needs a human run

On Windows, from a checkout of this branch:

1. `pnpm install`, then `pnpm --filter @tagalong/desktop test:e2e`. All smoke tests pass, including
   the wizard test.
2. `pnpm package:win`. Feature test 7.13.
3. Install that `.exe` on a machine (or Windows Sandbox) that never ran Tagalong. Feature tests 7.14,
   7.15 and 7.16, and the wizard through 7.10 with a real OpenRouter key.
4. Feature test 7.6 with a Token Factory key, confirming the Nemotron Nano 2 VL and Nemotron 3 Nano ids
   against the live list.
5. The demo run in `docs/testing/feature-test-guide.md`.
6. Add the installer steps below to the end of the `build` job's `steps:` in `.github/workflows/ci.yml` (indented to match), after the
   smoke test, and push them yourself.

### CI steps for the installer

```yaml
# Phase 7: the Windows installer, built the way the owner builds it and kept as an
# artifact so a reviewer can install exactly what this commit produces. Unsigned.
- name: Package Windows installer
  run: |
    pnpm --filter @tagalong/extension build
    pnpm --filter @tagalong/desktop package:win
  timeout-minutes: 20

- name: Upload Windows installer
  uses: actions/upload-artifact@v6
  with:
    name: tagalong-windows-installer
    path: apps/desktop/release/*.exe
    if-no-files-found: error
```
