# Phase 1: Foundation — acceptance

Run on **2026-09-11**, Windows 11 Home 10.0.26200, Node 22.17.0, pnpm 10.34.5, from `C:\ai_pet`.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

## Checks

| Command                              | Result                                |
| ------------------------------------ | ------------------------------------- |
| `pnpm lint`                          | ✅ exit 0                             |
| `pnpm format:check`                  | ✅ exit 0                             |
| `pnpm typecheck`                     | ✅ exit 0                             |
| `pnpm build`                         | ✅ exit 0                             |
| `pnpm test`                          | ✅ 34 files, 254 tests passed, exit 0 |
| `npx playwright test` (apps/desktop) | ✅ 2 passed, exit 0                   |

## Coverage

`pnpm test:coverage`, v8 provider, over `packages/core/src` and `packages/protocol/src` —
the hosts are covered by the Playwright smoke test instead, so they carry no bar.

| Metric     | Threshold | Measured             |
| ---------- | --------- | -------------------- |
| Statements | 70%       | **92.06%** (499/542) |
| Branches   | 70%       | **75.98%** (155/204) |
| Functions  | 70%       | **93.23%** (124/133) |
| Lines      | 70%       | **92.56%** (473/511) |

Branches is the tightest of the four; the uncovered ones are mostly error paths in
`server/ws-server.ts` and `providers/fake.ts`.

## Acceptance script

- [~] **Launch the app. A pet avatar sits at the right screen edge and a tray icon
  exists.** The smoke test launches the real built app and asserts that exactly two
  windows exist — `avatar.html` and `panel.html`, the panel hidden — which is only
  reached after `Engine.boot` succeeds. The tray is created on the same path. Where
  the avatar actually sits on screen, and whether it floats above other apps, is a
  human check.
- [ ] **Highlight a paragraph in a browser or PDF, press Ctrl+Shift+Space. The panel opens
      with a chip showing the captured selection length and window title.** Needs a human
      run: the smoke test opens the panel through the host API, because global hotkeys are
      unreliable on a CI desktop, so neither the hotkey nor the real selection capture is
      exercised here.
- [~] **Press Enter. Text streams within two seconds and the answer references the selected
  text.** The streaming half is verified: the smoke test types a question, presses
  Enter, and asserts the streaming bubble appears and is then replaced by a settled
  assistant message, with the bubble gone. That the answer _references the selected
  text_ is not verified — the run uses `TAGALONG_FAKE_PROVIDERS=1`, whose scripted
  reply ignores the input.
- [ ] **Ask a follow-up in the same panel. It has memory of the previous exchange.** Needs
      a human run with a real provider.
- [ ] **Restart the app. The conversation is still in the database and the avatar position
      is remembered.** Not exercised: the smoke test launches one instance for the whole
      file. The persistence code is unit tested (`memory/db.ts` and `memory/store.ts`, and
      the avatar position is written back through `settings.set`), but the restart itself
      has not been run.
- [~] **`pnpm test` passes with coverage above the threshold; CI is green.** Tests and
  coverage: yes, see above. CI on the pushed branch is **pending** — record the run id
  here once it completes.
- [x] **`docs/acceptance/phase-1.md` records the run.** This file.

## Engine transport

The engine binds `127.0.0.1:47321` and the desktop host is the single ws client, as the
phase page requires. Verified with `netstat` while the app was running: the port shows
`LISTENING` on the loopback address, plus one `ESTABLISHED` loopback pair between the host
and the engine. No other client, and nothing bound to an external interface.

## Needs a human run

Each of these needs a real desktop session, and the last two also need a real Anthropic key
in Settings — the fake provider returns scripted text that cannot satisfy them.

1. **Hotkey and selection capture.** Start the app, open a browser or a PDF, highlight a
   paragraph, press `Ctrl+Shift+Space`. Expect the panel to open with a context chip
   showing the captured selection length and the window title of the app you highlighted
   in. Check that your clipboard still holds whatever it held before the hotkey.
2. **The answer references the selection.** With an Anthropic key saved through Settings
   and the provider set to `anthropic`, repeat step 1 and press Enter on the empty
   composer, or type a question about the paragraph. Expect text within about two seconds
   and an answer that is visibly about the highlighted text.
3. **Follow-up memory.** In the same panel, ask a follow-up that only makes sense given the
   previous exchange ("summarise that in one line"). Expect an answer that uses the earlier
   turn.
4. **The avatar behaves like a desktop pet.** Confirm it sits at the right screen edge,
   stays above other windows when another app is focused, and can be dragged. Drag it
   somewhere distinctive, quit from the tray, start again, and confirm it reappears where
   you left it — and that the earlier conversation is still in the panel.
5. **CI.** Confirm the run on the pushed branch is green, and record the run id in the
   checklist above.

## Deviations from the phase page

| Phase page said                                                       | What shipped                                      | Why                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React renderer with `@vitejs/plugin-react`                            | `esbuild: { jsx: 'automatic' }`, no React plugin  | The plugin imports `vite/internal`, which exists only in Vite 8; electron-vite peers on vite ^5–7. Development has no Fast Refresh until that is fixed. |
| Workspace packages consumed as packages                               | electron-vite bundles them into the desktop build | They emit extensionless relative imports under `moduleResolution: bundler`, which Node's ESM loader cannot resolve. Only the native deps stay external. |
| Preload exposes `window.tagalong`                                     | `window.tagalong` plus `window.tagalongHost`      | The `HostBridge` stays exactly as specified; window and panel control needed a separate, host-only surface, which is also what the smoke test drives.   |
| Enter on an empty composer sends the default question, _Explain this_ | Not wired                                         | `Composer` in `packages/ui` does not emit an empty send; it needs a prop there, so the behaviour belongs with the component rather than the host.       |
| `packages/ui` styled with Tailwind 4                                  | Tailwind not built for the desktop renderer yet   | `@tagalong/ui`'s utility classes are inert in the app. Layout and behaviour are correct; the styling pass is outstanding.                               |

## Open items for the human

1. **Set `productName`** in `apps/desktop/package.json` before any packaging or
   auto-update work. Until then user data lands in `%APPDATA%\@tagalong\desktop`, and
   changing it later strands every existing user's settings, secrets and database. See the
   [Tagalong Issues](https://app.notion.com/p/fbe46b28758244c586dde6f27f9696ac) database in
   Notion.
2. **Add an Anthropic API key** through the Settings window to exercise the real provider.
   It is stored through `SecretStore` with Electron `safeStorage` — not from `.env.local`,
   which nothing reads for this.
3. **Run the five manual acceptance steps above** and tick the remaining boxes.
