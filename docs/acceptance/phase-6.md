# Phase 6: Browser Host — acceptance

Run on **2026-10-04** in a Linux build container (Node 22.22.0, pnpm 10.34.5, Chromium 141 headless
from `/opt/pw-browsers`), not on the Windows desktop the app targets and not in a windowed Chrome.

Marks: `[x]` verified in this run, `[~]` partly verified — the rest of that item is under
_Needs a human run_, `[ ]` not verified here.

No model provider was called to produce this record. Every engine in it ran on the fake provider
(`TAGALONG_FAKE_PROVIDERS=1`).

## Checks

| Command                                        | Result                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `pnpm lint`                                    | ✅ exit 0                                                  |
| `pnpm format:check`                            | ✅ exit 0                                                  |
| `pnpm typecheck`                               | ✅ exit 0                                                  |
| `pnpm test`                                    | ✅ 77 files, 989 tests passed (3 skipped), exit 0          |
| `pnpm --filter @tagalong/extension build`      | ✅ `dist/` with manifest, worker, side panel, options page |
| `npx playwright test` (apps/desktop, Electron) | not run: needs Windows and the Electron binary             |

## Coverage

`pnpm test:coverage` over `packages/core/src` and `packages/protocol/src`.

| Metric     | Threshold | Phase H | Phase 6    |
| ---------- | --------- | ------- | ---------- |
| Statements | 70%       | 93.73%  | **93.97%** |
| Branches   | 70%       | 84.43%  | **84.96%** |
| Functions  | 70%       | 96.40%  | **96.59%** |
| Lines      | 70%       | 94.86%  | **94.99%** |

`perception/browser-route.ts`, the new core module: 97.9% statements, 93.3% branches, 100% lines.

## How the browser runs were made

The real engine (`Engine.boot` from `@tagalong/core`, fake provider, a temp data dir) was bundled
into one script and run on `127.0.0.1:47321`. The built extension was loaded unpacked into headless
Chromium 141 with Playwright (`--load-extension`, `--headless=new`) and driven through its own pages.
Headless Chromium cannot click the toolbar button, so it can never grant `activeTab`; the two runs
that read a page used a copy of `dist/` with `host_permissions: ["<all_urls>"]` added. That copy was
not committed, and the shipped manifest has no standing host permission.

**Pairing, disconnect, recovery** (shipped `dist/`):

```
[0.7s] before pairing: Not paired. Paste the pairing token from Tagalong Settings in the extension options.
[0.8s] bad token message: That is not a pairing token. Copy the 64-character token from Tagalong Settings.
[0.9s] after pairing: Connected to Tagalong 0.0.0-e2e.
[0.9s] engine stopped: Disconnected: could not reach the Tagalong app. Retrying in 1s. Is the Tagalong app running?
[1.9s] recovered: Connected to Tagalong 0.0.0-e2e.
[2.0s] wrong token: The Tagalong app rejected the pairing token. Paste the current one.
```

**Page reader** (a 700-paragraph file:// article, a selection made in the page):

```
host: extension | app: {"name":"chrome","windowTitle":"Long release notes"}
selection: "Line one, “quoted” — line two."
page text length: 40000 | has nav/footer: false
```

The selection is Chrome's own `Selection.toString()`, passed through untouched: the text as rendered,
which is what the user sees highlighted and what Ctrl+C copies.

**Side panel** (opened as an extension page beside the article tab):

```
[0.9s] status: Connected to Tagalong 0.0.0-e2e.
[0.9s] crew: 🔎 Scout
[1.0s] messages: ["user: Say hello from the side panel","assistant: This is the fake pet. I stream scripted text so tests never call the network."]
[1.5s] sight bar after Read this page: 👁Seeing8 chars · page “Long release notes”Clear
[1.5s] second answer arrived with the page attached
[2.6s] after quit: Disconnected: could not reach the Tagalong app. Retrying in 1s. Is the Tagalong app running? | composer present: true
[3.7s] recovered: Connected to Tagalong 0.0.0-e2e.
```

## Acceptance script

- [~] **Pair the extension. The side panel shows the crew.** Pairing, the options page, and the side
  panel's crew picker were driven in headless Chromium against a real engine (above). Opening the
  real side panel from the toolbar button needs a windowed Chrome.
- [~] **Select text on a page and press the shortcut. The exact selection and page title appear in
  the context chip and the answer arrives.** The reader returns the exact selection and the title
  in Chromium; the chip shows `N chars · page "<title>"` (unit test and Chromium run); answers stream
  into the panel. The command itself (`Alt+Shift+Space`) cannot be pressed headlessly.
- [~] **Ask about the whole page with nothing selected. Page text is used, not a screenshot.** The
  panel attaches the page it opened beside and its Look reads the page, never a screenshot (unit
  tests; Chromium run with the page chip). That the _answer_ uses the page needs a real model.
- [x] **Quit the desktop app. The side panel shows disconnected and recovers when the app returns.**
      Engine process killed and restarted under the panel: "Disconnected … Is the Tagalong app running?",
      then "Connected" again in about a second, with the conversation kept on screen.
- [x] **Tests cover Readability extraction limits, pairing storage, reconnect, and routing with a
      fake engine.** `content/read-page.test.ts` (40,000 cap, truncation flag, article vs. chrome, body
      fallback, exact and textarea selections, selection cap), `pairing.test.ts`,
      `engine-connection.test.ts` (backoff, rejected token, heartbeat, recovery),
      `perception/browser-route.test.ts` and three engine tests over real sockets (extension first,
      500 ms fallback, `get_selection` routing, exclusions).

## Tasks

- **61 — MV3 scaffold.** `[~]` Loads unpacked in Chromium 141; worker registers; panel behaviour
  `openPanelOnActionClick: true`; side panel and options pages render. A windowed Chrome must open
  the side panel from the toolbar.
- **62 — pairing and reconnecting socket.** `[x]` `hello` succeeds with the token; disconnected shown
  while the engine is down; recovery; rejected token. Desktop Settings shows the token with a copy
  button (needs a Windows look).
- **63 — content script.** `[x]` Text capped at 40,000 characters; selection exact (as Chrome reports
  it). Injected file 35 kB with no zod.
- **64 — perception routing.** `[x]` Fake hosts: browser in front plus extension connected routes to
  the extension; a refusal falls back at once; silence falls back after 500 ms.
- **65 — side panel and shortcut.** `[~]` Asks from the side panel stream text. Approval cards do not
  exist yet (Phase 5); the shortcut needs a windowed Chrome.
- **66 — docs.** `[x]` This record, the README section "The Chrome extension", `docs/architecture.md`
  ("Routing between the desktop and the browser host", "The browser host"), and the Phase 6 section of
  `docs/testing/feature-test-guide.md`.

## Needs a human run

Use [the feature test guide](../testing/feature-test-guide.md), section "Phase 6: Browser Host".

- [ ] 6.1–6.4 in a windowed Chrome on Windows: load unpacked, pair from the desktop Settings copy
      button, open the side panel from the toolbar button, crew listed.
- [ ] 6.5 with OpenRouter + a Claude model: a whole-page summary that is about the page.
- [ ] 6.6–6.7: `Alt+Shift+Space` opens the panel with the exact selection and the page title.
- [ ] 6.8–6.9: the desktop hotkey in Chrome with the all-tabs opt-in on (exact selection and page
      text reach the answer) and off (clipboard fallback, no delay).
- [ ] 6.10–6.11 with the real desktop app quit from the tray and restarted.
- [ ] 6.12–6.15: exclusions on tab titles, `chrome://` pages, a wrong token, switching pets.
- [ ] Approval cards in the side panel — when Phase 5 lands.
- [ ] The Electron smoke suite on Windows.
