# Tagalong feature test guide

Step-by-step manual tests for what each phase adds, written so someone who did not build the
feature can run it and know whether it passed. Each step lists **Setup**, **Action** and
**Expected**. A step passes only if everything under Expected is true.

## Contents

- [Configuration](#configuration)
  - [OpenRouter + Claude (the default for this guide)](#openrouter--claude-the-default-for-this-guide)
  - [Nebius Token Factory + Nemotron](#nebius-token-factory--nemotron)
  - [Fake provider (no key)](#fake-provider-no-key)
- [Phase H: model providers](#phase-h-model-providers)
- [Phase 6: Browser Host](#phase-6-browser-host)
- [Phase 4: Crew](#phase-4-crew)
- [Phase 3B: Awareness](#phase-3b-awareness)
- [Phase 7: onboarding and installer](#phase-7-onboarding-and-installer)
- [Voice: Scout talks](#voice-scout-talks)
- [Talk to Scout](#talk-to-scout)
- [Connections: your apps over MCP](#connections-your-apps-over-mcp)
- [Routines](#routines)
- [Demo run: the hackathon story](#demo-run-the-hackathon-story)
- [Not in this build](#not-in-this-build)

## Configuration

Every test runs on the Windows desktop app, either installed (Phase 7) or from source with
`pnpm dev:desktop` **without** `TAGALONG_FAKE_PROVIDERS`. Keys are entered in the setup wizard or in
Settings (tray → **Settings**); a saved key is used from the next question, with no restart.

### OpenRouter + Claude (the default for this guide)

Unless a step says otherwise, run every test with **OpenRouter and a Claude model**.

1. Get a key at <https://openrouter.ai/keys> and paste it into **OpenRouter API key**.
2. For each pet under test set **Provider** to OpenRouter and **Model id** to a Claude id, for example
   `anthropic/claude-sonnet-5`. Leave **Vision model id** empty: on OpenRouter every model is treated
   as seeing, and Claude does.
3. Save.

**Where the model ids come from.** OpenRouter's catalog, <https://openrouter.ai/models>, which is also
what `GET https://openrouter.ai/api/v1/models` returns. The model box in Settings and in the wizard
lists those ids live once the key is stored, and its note says "N models from OpenRouter"; "Built-in
list" means the key or base URL was refused.

### Nebius Token Factory + Nemotron

Steps marked _hackathon demo_ also use Nebius Token Factory with NVIDIA Nemotron.

1. Get a key at <https://tokenfactory.nebius.com/> (API keys) and paste it into **Token Factory API
   key**.
2. For a pet on Nemotron set **Provider** to Token Factory and pick its models:

| Role                      | Model id                            | Model                                |
| ------------------------- | ----------------------------------- | ------------------------------------ |
| Text (a pet's main model) | `nvidia/nemotron-3-super-120b-a12b` | Nemotron 3 Super                     |
| Vision (sees screenshots) | `nvidia/Nemotron-Nano-V2-12b`       | Nemotron Nano 2 VL                   |
| Watch checks              | `nvidia/nemotron-3-nano-30b-a3b`    | Nemotron 3 Nano (small, cheap, text) |

**Where the model ids come from.** Token Factory's model list, `GET
https://api.tokenfactory.nebius.com/v1/models`, which Settings and the wizard show live once the key
is stored ("N models from Token Factory"). The Super id is the one Nebius published with Nemotron 3
Super; the Nano 2 VL and Nemotron 3 Nano ids could not be checked when they were written. If the live
list names them differently, use the listed id and record the difference in Notion Issues. A pet on
Super needs the Nano 2 VL id as its **Vision model id** to see pictures (the wizard sets it for you).

### Fake provider (no key)

Steps marked _fake provider_ need no key: launch from source with `TAGALONG_FAKE_PROVIDERS=1`
(PowerShell: `$env:TAGALONG_FAKE_PROVIDERS = '1'`). Every pet then streams a scripted answer and
nothing leaves the machine.

## Phase H: model providers

Covers the OpenAI-compatible provider, the OpenRouter and Token Factory presets, per-pet models and
vision routing (PR #22).

**Before you start:** launch without `TAGALONG_FAKE_PROVIDERS` (`pnpm dev:desktop`), then open
Settings from the tray.

### H1. OpenRouter key and live model list

1. **Setup:** an OpenRouter API key.
2. **Action:** paste it into **OpenRouter API key**, click Save, close and reopen Settings.
3. **Expected:** the key box says "one is stored"; Scout's note says "N models from OpenRouter". If
   it says "Built-in list", the key or base URL was refused — stop and fix that first.

### H2. OpenRouter + Claude: text

1. **Setup:** Scout's **Provider** is OpenRouter, **Model ID** is a Claude id taken from the live
   list, **Vision model ID** is empty. Saved.
2. **Action:** press `Ctrl+Shift+Space` and ask a question.
3. **Expected:** the answer streams and ends with no error.

### H3. OpenRouter + Claude: look

1. **Setup:** as H2.
2. **Action:** click Scout and ask "what is on my screen?".
3. **Expected:** Scout calls `look_at_screen`; the answer describes the screen, with **no** "cannot
   see images" warning.

### H4. OpenRouter + Claude: an image inside a tool result

1. **Setup:** as H2.
2. **Action:** click Scout and ask it to zoom in on something small on your screen.
3. **Expected:** Scout calls `look_closer`; the tool result shows as "1 image"; the answer describes
   the zoomed detail.

### H5. OpenRouter + Claude: a tool without an image

1. **Setup:** as H2.
2. **Action:** with windows on two screens and one minimized, ask "What do you see?".
3. **Expected:** Scout calls `list_windows` only (no screenshot, no `read_window_text`) and answers
   briefly per screen, numbered as the composite labels them, then what is minimized, for example
   "Screen 1: VS Code on engine.ts, Chrome behind it. Screen 2: Slack. Minimized: Outlook."
4. **Action:** ask "can you read the task in Chrome?".
5. **Expected:** Scout calls `read_window_text` on that one window and answers from its text.

### H6. Token Factory + Nemotron

_Not the default configuration: this step uses Nebius Token Factory._

1. **Setup:** paste a key into **Token Factory API key**, Save, reopen Settings; the note
   says "models from Token Factory". Set Scout's **Provider** to Token Factory, **Model ID** to
   `nvidia/nemotron-3-super-120b-a12b`, **Vision model ID** to the Nemotron Nano 2 VL id from the
   live list (if it is not `nvidia/Nemotron-Nano-V2-12b`, correct `NEMOTRON_VISION_MODEL`). Save.
2. **Action:** (a) `Ctrl+Shift+Space` with a question; (b) "what is on my screen?"; (c) ask to
   zoom in on something small; (d) clear the vision model id, save, ask (b) again.
3. **Expected:** (a) answered by Super; (b) answered with no warning, the request goes to Nano VL
   (check the Token Factory usage page); (c) the turn starts on Super and continues on Nano VL after
   `look_closer`; (d) the "Scout cannot see images" warning and a text-only answer.

### H7. Settings edge cases

1. **Setup:** Settings open.
2. **Action:** (a) enter a bad base URL such as `openrouter.ai` and save; (b) blank the box and save;
   (c) remove the key (clear the box, Save) and ask.
3. **Expected:** (a) refused on save with a message naming the service; (b) back to the default;
   (c) the turn error "No … API key is stored. Add one in Settings." and the app keeps running.

## Phase 6: Browser Host

Covers the Chrome extension: build and load, pairing, the side panel, exact selections and page
text, the shortcut, the desktop hotkey in Chrome, disconnect and recovery, and the opt-in to read
any tab.

**Before you start:**

- Windows with Chrome 116 or newer, and the desktop app running (installed, or `pnpm dev:desktop`)
  with the [test configuration](#openrouter--claude-the-default-for-this-guide).
- A long article open in a Chrome tab — for example a Wikipedia article — referred to below as
  _the article_.
- In the desktop app's Settings, the capture exclusion list includes the title pattern `*Bank*`
  (used in 6.12; remove it afterwards if you do not want it).

### 6.1. Build and load the unpacked extension

1. **Setup:** a checkout with dependencies installed (`pnpm install`).
2. **Action:** run `pnpm --filter @tagalong/extension build`. In Chrome open `chrome://extensions`,
   switch on **Developer mode**, click **Load unpacked**, choose `apps/extension/dist`. Pin Tagalong
   from the puzzle-piece menu.
3. **Expected:** the build ends without errors and `apps/extension/dist` holds `manifest.json`,
   `service-worker.js`, `sidepanel.html`, `options.html` and `page-reader.js`. The Tagalong card shows
   no errors, and a new tab opens with the options page ("Pair Tagalong with this browser"). Its
   connection line says "Not paired. …".

### 6.2. Refuse a bad token

1. **Setup:** the options page from 6.1.
2. **Action:** type `hello` into **Pairing token** and click **Save and connect**.
3. **Expected:** "That is not a pairing token. Copy the 64-character token from Tagalong Settings."
   The connection line still says "Not paired".

### 6.3. Pair

1. **Setup:** the desktop app running.
2. **Action:** in the desktop app, tray → **Settings** → **Browser extension** → **Copy token**.
   (The button changes to "Copied".) Paste into the options page and click **Save and connect**. Leave
   the port empty.
3. **Expected:** within two seconds the connection line reads "Connected to Tagalong <version>."

### 6.4. The side panel shows the crew

1. **Setup:** paired (6.3); the article tab in front.
2. **Action:** click the Tagalong toolbar button.
3. **Expected:** the side panel opens. Its header says "Connected to Tagalong …" and has a **Pet**
   picker listing every pet (emoji and name). The sight bar says "Seeing" and names
   `page "<article title>"`.

### 6.5. Ask about the whole page with nothing selected

1. **Setup:** 6.4, with nothing selected on the article.
2. **Action:** in the side panel ask "Summarise this page in three bullet points."
3. **Expected:** the answer streams into the panel and summarises **the article's** content — not a
   generic answer, not "I can't see the page". No screenshot is involved: the sight bar shows no
   thumbnail, and the panel's Look button reads **Read this page**, not "Look at screen".

### 6.6. Exact selection with the extension shortcut

1. **Setup:** close the side panel. On the article, select one sentence that contains punctuation or
   quotes.
2. **Action:** press `Alt+Shift+Space`.
3. **Expected:** the side panel opens; the sight bar shows "Seeing", the selection's character count
   and `page "<article title>"`. Ask "Quote back exactly what I selected." The answer contains the
   sentence exactly as you selected it.

### 6.7. Shortcut is listed and rebindable

1. **Setup:** none.
2. **Action:** open `chrome://extensions/shortcuts`.
3. **Expected:** Tagalong lists "Open Tagalong with the selection attached" bound to
   `Alt+Shift+Space`. (`Ctrl+Shift+Space` is the desktop app's global hotkey and is deliberately not
   used here.)

### 6.8. The desktop hotkey in Chrome gets the exact selection and the page

1. **Setup:** on the options page, click **Allow reading any tab when I ask** and accept Chrome's
   prompt; the line after the button reads "On." Open a **new** tab with a different article, select a
   sentence, and leave Chrome in front.
2. **Action:** press the desktop hotkey `Ctrl+Shift+Space` and ask "What did I select, and what is
   this page about?".
3. **Expected:** the desktop panel opens as usual. The answer quotes the selection exactly and
   describes the page — evidence the engine used the extension's page text, which the desktop host
   cannot read on its own.

### 6.9. The desktop hotkey falls back when the extension cannot read the tab

1. **Setup:** on the options page click **Stop reading other tabs** (the line reads "Off."). Open a
   new tab, load a page, select a sentence — do **not** click the toolbar button on this tab.
2. **Action:** press `Ctrl+Shift+Space` and ask "What did I select?".
3. **Expected:** the answer still quotes the selection (from the desktop's clipboard read), arrives
   without a noticeable delay, and shows no error. The page text is not used.

### 6.10. Quit the desktop app: the panel shows disconnected

1. **Setup:** the side panel open with at least one question and answer in it.
2. **Action:** quit the desktop app from the tray.
3. **Expected:** within a few seconds the header turns red and reads "Disconnected: could not reach
   the Tagalong app. Retrying in Ns. Is the Tagalong app running?". The earlier conversation stays on
   screen. Sending a message now shows "not connected to the Tagalong app …" in the chat instead of
   hanging.

### 6.11. The panel recovers when the app returns

1. **Setup:** 6.10.
2. **Action:** start the desktop app again and wait.
3. **Expected:** within about 30 seconds (usually one or two) the header reads "Connected to
   Tagalong …" again, without reloading the panel. A new question is answered.

### 6.12. Exclusions apply to browser tabs

1. **Setup:** the `*Bank*` title pattern in the exclusion list; any page whose tab title contains
   "Bank", with a sentence selected; the all-tabs opt-in from 6.8 **On**.
2. **Action:** press `Ctrl+Shift+Space` and ask "What did I select?".
3. **Expected:** the desktop reports capture is blocked for this window; the answer does not contain
   the selected sentence or the page's text.
4. **Action:** on the same tab open the side panel and ask "What does this page say?".
5. **Expected:** the answer does not contain the page's text: the engine strips a side-panel ask made
   on an excluded tab down to the tab's identity before the pet sees it.

### 6.13. Pages Chrome does not let extensions read

1. **Setup:** the side panel open.
2. **Action:** switch to a `chrome://settings` tab, then click **Read this page**.
3. **Expected:** the sight bar says "Capture did not work" (switching tabs first clears the previous
   page from the chip). Nothing from the previous page is attached to the next ask.

### 6.14. A wrong token is rejected

1. **Setup:** paired and connected.
2. **Action:** on the options page, replace the token with 64 `f` characters and click **Save and
   connect**.
3. **Expected:** the connection line reads "The Tagalong app rejected the pairing token. Paste the
   current one." and the side panel header shows the same with a **Pair with the Tagalong app**
   button. Paste the real token again to recover.

### 6.15. Switching pets in the side panel

1. **Setup:** at least two pets (the default crew has three); side panel open and connected.
2. **Action:** click the second avatar in the crew strip at the top of the chat (its tooltip names
   the pet) and ask "Who are you?".
3. **Expected:** the header names that pet in its colour; the answer comes in its role and is
   labelled with its name and model. Earlier messages stay on screen: the crew shares one timeline.

## Phase 4: Crew

Covers the default crew, memory and recall, conversation summaries, handoff, consult, the roundtable,
the crew strip, the pet editor and the model-call counter (tasks 44–51).

**Test configuration.** [OpenRouter + Claude](#openrouter--claude-the-default-for-this-guide). One test, 4.13,
uses a mixed crew on OpenRouter and Nebius Token Factory. Per-pet voices are not built, so nothing in
this phase speaks; every "voice" in the phase page is checked as text.

**Before you start:**

1. Quit Tagalong. Rename `%APPDATA%\Tagalong` to `Tagalong.before-phase-4` so the app starts as a
   fresh install (rename it back afterwards to keep your old history).
2. Launch with `pnpm dev:desktop` (no `TAGALONG_FAKE_PROVIDERS`).
3. Skip the setup wizard (Phase 7 tests it). Open Settings from the tray, paste your **OpenRouter
   API key** and click Save.

### 4.1. A fresh install seeds three pets

1. **Setup:** the fresh data directory from _Before you start_.
2. **Action:** look at the desktop, then open Settings.
3. **Expected:** the desktop shows **three** avatars side by side — 🔎 Scout, ✒️ Ink, ⚡ Bolt, Scout
   first — each with a coloured underline (blue, purple, amber). Settings shows three pet sections:
   Scout on **Token Factory** / `nvidia/nemotron-3-super-120b-a12b`, Ink on **OpenRouter** /
   `anthropic/claude-sonnet-5`, Bolt on **Token Factory** / `nvidia/Nemotron-Nano-V2-12b`.

### 4.2. Put the whole crew on OpenRouter + Claude

1. **Setup:** Settings open, OpenRouter key stored (Scout's note says "N models from OpenRouter"
   once its provider is OpenRouter).
2. **Action:** for **Scout** and **Bolt**, set **Provider** to OpenRouter, **Model id** to a Claude
   id from the live list (for example `anthropic/claude-sonnet-5`), and clear **Vision model id**.
   Leave Ink as it is (check its model id appears in the live list; if not, pick a Claude id that
   does). Click Save.
3. **Expected:** "Saved." with no error. Hovering each desktop avatar shows `Name · model` with the
   Claude id.

### 4.3. The crew strip opens the panel on a pet

1. **Setup:** 4.2 done.
2. **Action:** click Ink's avatar on the desktop.
3. **Expected:** the panel opens beside the strip; its header reads **✒️ Ink** in purple and the
   Ink button in the panel's strip is ringed. Click Bolt in the panel's strip: the header changes to
   **⚡ Bolt** in amber.

### 4.4. Every answer names the pet and the model

1. **Setup:** panel open on Scout.
2. **Action:** select a paragraph on a web page, press `Ctrl+Shift+Space`, ask "Explain this".
3. **Expected:** while it streams and after it settles, a small label above the answer reads
   `Scout · <the Claude id you chose>` in Scout's blue.

### 4.5. Follow-ups continue the same conversation

1. **Setup:** right after 4.4, panel still open.
2. **Action:** ask "What did I just ask you?".
3. **Expected:** Scout restates the previous question. (Before Phase 4 every ask opened a new
   conversation and this failed.)

### 4.6. Handoff with `@Ink` keeps the context _(acceptance 1)_

1. **Setup:** open a page with an email or a forum post. Select it, press `Ctrl+Shift+Space`, and ask
   Scout "Explain this page". Wait for the answer.
2. **Action:** type `@Ink draft a reply to this` and press Enter.
3. **Expected:**
   - A dashed bubble appears: **"Scout handed this to Ink"** followed by two paragraphs — what you
     asked Scout (naming the page) and Scout's latest answer.
   - The header switches to **✒️ Ink**.
   - Ink's answer, labelled `Ink · <model>`, is a draft reply that refers to the specific content of
     the page — names, dates or points that only appear on it — without you pasting it again.
   - Ask Ink "make it warmer": Ink revises its own draft (same conversation).

### 4.7. The Hand off menu

1. **Setup:** any answer from Scout on screen.
2. **Action:** under the answer, open **Hand off…** and choose **⚡ Bolt**.
3. **Expected:** the composer now contains `@Bolt ` with the cursor ready; type "check this for bugs"
   and send — the handoff bubble and a Bolt answer follow as in 4.6.

### 4.8. Consult: Bolt asks Ink _(acceptance 2)_

1. **Setup:** panel on Bolt (click Bolt in the strip). Copy a small code diff to the screen and select
   it.
2. **Action:** press `Ctrl+Shift+Space` and ask: "Write a commit message for this change. Ask Ink to
   polish the wording before you answer."
3. **Expected:**
   - A small amber card appears above Bolt's answer: **"Bolt consulted Ink: …"** with the question.
   - Bolt's answer contains a polished commit message.
   - The footer under the composer shows **"3 model calls"** (or more if Bolt also used a tool).
   - Ink does not get a bubble of its own: a consult is not a handoff, and the panel stays on Bolt.

### 4.9. A consult that fails is reported to the caller, not to you

1. **Setup:** in Settings set **Ink**'s provider to **Token Factory** with no Token Factory key
   stored. Save.
2. **Action:** on Bolt, ask "Ask Ink to suggest a name for a logging library, then give me your pick."
3. **Expected:** the consult card appears; Bolt still answers on its own, and may say Ink could not be
   reached. No red error replaces Bolt's answer. Set Ink back to OpenRouter afterwards.

### 4.10. Roundtable with `/crew` _(acceptance 3, text only)_

1. **Setup:** crew as in 4.2, panel open on Scout.
2. **Action:** type `/crew Should a desktop companion's chat panel dock left or right of the
avatar?` and press Enter.
3. **Expected:**
   - A divider **"Round 1 of 2"**, then three answers in order — Scout, Bolt, Ink (the asked pet first,
     then the rest alphabetically) — each labelled with its own name and model, each avatar on the
     desktop lighting amber while it speaks.
   - The second and third pets refer to what the earlier ones said.
   - A divider **"Synthesis by Scout"**, then one paragraph from Scout that summarises agreement and
     disagreement and recommends one side.
   - While it runs the composer is disabled and a **Stop** button is shown; afterwards both return to
     normal and the footer reads **"4 model calls"**.

### 4.11. Stop a roundtable

1. **Setup:** as 4.10.
2. **Action:** start `/crew Tabs or spaces?` and press **Stop** while the second pet is answering.
3. **Expected:** the stream stops; a divider **"Roundtable stopped"** appears; no further pet answers
   and no synthesis follows; the composer is enabled again.

### 4.12. The Crew button

1. **Setup:** panel open, composer empty.
2. **Action:** click **Crew**.
3. **Expected:** the composer reads `/crew ` ready for a question. Clear it, type "Is it worth adding
   dark mode?", click **Crew** again: a roundtable starts on that question exactly as in 4.10.

### 4.13. Roundtable across providers: OpenRouter + Nebius Nemotron _(hackathon demo)_

_This test changes the test configuration on purpose._

1. **Setup:** store a **Token Factory API key** as well (Settings, Save). Then set:
   - **Scout** — Token Factory, `nvidia/nemotron-3-super-120b-a12b`, vision model
     `nvidia/Nemotron-Nano-V2-12b`
   - **Bolt** — Token Factory, `nvidia/Nemotron-Nano-V2-12b`, vision model empty
   - **Ink** — OpenRouter, a Claude id from the live list

   Click Save. (These are the fresh-install defaults; if you never changed them, nothing to do.)

2. **Action:** on Scout, run `/crew What is the single most useful feature a screen companion could
add next?`.
3. **Expected:**
   - Three answers labelled `Scout · nvidia/nemotron-3-super-120b-a12b`,
     `Bolt · nvidia/Nemotron-Nano-V2-12b` and `Ink · <Claude id>` — three models from two providers.
   - The synthesis is by Scout on Nemotron 3 Super; the footer reads **"4 model calls"**.
   - Repeat with the Token Factory key removed: Scout's and Bolt's turns fail, the transcript Ink sees
     says "(Scout could not answer: …)", Ink still answers, and the run ends without hanging.

### 4.14. A stated preference survives a restart _(acceptance 4)_

1. **Setup:** crew as in 4.2; panel on Scout.
2. **Action:** say "I prefer short answers." Wait for the reply. Quit Tagalong from the tray and
   launch it again. Open the panel on Scout and ask "Explain how DNS works."
3. **Expected:** the DNS answer is noticeably short (a few sentences, no long lists).

### 4.15. Shared memories reach every pet; private ones do not

1. **Setup:** 4.14 done.
2. **Action:** on Scout, say "Remember for the whole crew that I deploy on Fridays." Then click Ink
   in the strip and ask "When do I usually deploy?". Then ask Ink "Do I prefer long or short answers?".
3. **Expected:** Scout calls the `remember` tool (the reply confirms it saved it to the crew notebook).
   Ink answers **Fridays**. Ink does **not** know about the short-answers preference, which is
   private to Scout (it may guess, but must not claim you told it).

### 4.16. Long conversations are folded into a summary

1. **Setup:** a tool that opens SQLite (`sqlite3`, or DB Browser for SQLite).
2. **Action:** in one Scout conversation, exchange at least **10** questions and answers (20 messages)
   about one topic. Wait ten seconds after the tenth answer. Open `%APPDATA%\Tagalong\tagalong.db` and
   run `SELECT kind, text FROM memories WHERE kind = 'summary';` and
   `SELECT COUNT(*) FROM messages WHERE summarized_at IS NOT NULL;`.
3. **Expected:** one `summary` row describing the topic, and **16** summarised messages. Ask Scout a
   follow-up that depends on the start of the conversation: it still answers correctly (recall
   carries the summary).

### 4.17. Choose a different summarizer

1. **Setup:** Settings open, an OpenRouter key stored, Claude Code installed and signed in.
2. **Action:** open **Advanced**, then the **Summarize with** list.
3. **Expected:** the list starts with **Same as Scout (default)**, then a **Claude sign-in** group
   with **Haiku** and **Sonnet** (no Opus), then an **OpenRouter** group with its live models.
   Services with no key are not listed. Pick `anthropic/claude-haiku-4.5` and Save: "Saved. Scout uses
   it from the next ask." Reopen Settings: the choice is still selected. Pick **Same as Scout** and
   Save to go back.

### 4.18. Edit a pet

1. **Setup:** Settings open.
2. **Action:** for Bolt change **Name** to `Sparky`, **Emoji** to `🔧`, **Colour** to green, and add
   "Always answer in British English." to **Notes (optional, private)**. Save.
3. **Expected:** the desktop strip re-draws with 🔧 and a green underline; the panel header reads
   **🔧 Sparky** in green; a new question to Sparky is answered in British spelling. **Reply style**
   and **Voice id** save without error but change nothing audible (Scout's voice is set in Settings → Voice).

### 4.19. Add, hide and delete pets

1. **Setup:** Settings open.
2. **Action:** click **Add a pet**, name it `Pip`, give it OpenRouter and a Claude id, Save. Then untick
   **Show on the desktop strip** for Pip and Save. Then click **Delete Ink**, Save, and restart the app.
3. **Expected:** after the first save a fourth avatar appears on the strip; after the second it is gone
   from the strip but Pip still appears in the panel's strip and answers; after the restart Ink is gone
   everywhere and does **not** come back (deleted defaults are not re-seeded). `@Ink` is now ordinary
   text sent to the current pet.

### 4.20. The side panel speaks crew too

1. **Setup:** the Chrome extension paired (Phase 6); a page open beside the side panel.
2. **Action:** in the side panel ask Scout "Summarise this page", then type `@Ink draft a tweet about
it`, then run `/crew Is this article convincing?`.
3. **Expected:** the same handoff bubble, labels, round dividers, synthesis and model-call count as in
   the desktop panel.

## Phase 3B: Awareness

Covers rolling memory and its recording dot, `recall_screen` and `what_changed`, watch mode with its
Watching chip, the watch check model, the Awareness settings, and the image token estimate in the
sight bar (tasks 87, 81, 88, 82, 89, 85, 90).

**Test configuration.** [OpenRouter + Claude](#openrouter--claude-the-default-for-this-guide). Test 3B.16 runs a
watch on **Nebius Token Factory with Nemotron 3 Nano** as the check model. Voice (Phase 3) is not built,
so a watch that fires is **shown, not spoken** — every "spoken" expectation in the phase page is checked
as a card, a toast and an avatar alert.

**Before you start:**

1. Launch with `pnpm dev:desktop` (no `TAGALONG_FAKE_PROVIDERS`). You need a Windows desktop with a
   terminal (Windows Terminal or `cmd`) and a browser.
2. Open Settings from the tray. Store your **OpenRouter API key**, then set **Scout** to **Provider**
   OpenRouter, **Model id** a Claude id from the live list (for example `anthropic/claude-sonnet-5`),
   **Vision model id** empty, and **Watch check model** empty. Click Save.
3. Keep `%APPDATA%\Tagalong` open in Explorer: several tests check that nothing new is written there.

### 3B.1. The Awareness settings and their defaults

1. **Setup:** Settings open.
2. **Action:** scroll to **Awareness**, then to Scout's section.
3. **Expected:**
   - **Rolling memory** is unticked, **Minutes to remember** is 10, **Checks per watch** 60,
     **Watches at once** 3, **Watch timeout** 30.
   - Scout's **Watch check model** box is empty and its grey placeholder reads
     `anthropic/claude-haiku-4.5`; the note under it names OpenRouter's default.
   - Switching Scout's **Provider** to Token Factory (do not save) changes the placeholder to
     `nvidia/nemotron-3-nano-30b-a3b`. Switch it back.

### 3B.2. Turning rolling memory on shows the red dot, without a restart

1. **Setup:** 3B.1; the desktop avatars visible.
2. **Action:** tick **Rolling memory**, click Save. Do not restart.
3. **Expected:** within a second every pet avatar shows a **small red dot** in its bottom-left corner.
   Hovering an avatar's label says it is recording the screen. No new file appears in
   `%APPDATA%\Tagalong` (only `tagalong.db`, `settings.json`, `secrets.json`, `pairing.token` and the
   logs that were there before).

### 3B.3. "What was I reading five minutes ago?" _(acceptance 1)_

1. **Setup:** rolling memory on (3B.2). In the browser, open a page with a distinctive title — for
   example the Wikipedia article "Transformer (deep learning architecture)" — and leave it in front for
   one minute. Then switch to a different app (Notepad, say) and wait **five minutes**.
2. **Action:** press `Ctrl+Shift+Space`, ask Scout: `what was I reading five minutes ago?`
3. **Expected:**
   - The panel shows a `recall_screen` tool row (with "1 image" or "2 images" as its summary).
   - The answer names the Wikipedia article (title or content), and **states a time** — a clock time or
     "about five minutes ago" — rather than describing it as what is on screen now.
   - It does not describe Notepad as what you were reading.

### 3B.4. Asking further back than memory reaches

1. **Setup:** rolling memory on; set **Minutes to remember** to **1**, Save (no restart). Wait 90 s.
2. **Action:** ask Scout: `what was on my screen ten minutes ago?`
3. **Expected:** the answer says memory only reaches back about a minute and describes the oldest
   moment it has, with its time. It does not invent a ten-minute-old screen. Set the minutes back to
   **10** and Save.

### 3B.5. Rolling memory off

1. **Setup:** in Settings → Privacy switch **Remember the last few minutes of the screen** off, Save.
2. **Action:** confirm the red dot is gone from every avatar, then ask Scout:
   `what was I doing two minutes ago?`
3. **Expected:** the dot disappeared on save. The answer says rolling memory is off and that it can be
   turned on in Settings under Privacy. Switch **Remember the last few minutes of the screen** on
   again and Save before continuing.

### 3B.6. What changed on screen

1. **Setup:** rolling memory on for at least two minutes. Leave a terminal in front showing a prompt.
2. **Action:** in the terminal run `echo the quick brown fox`, then ask Scout:
   `what changed on my main screen in the last minute?` (if Scout asks which display, answer "1" or
   tell it to list the displays).
3. **Expected:** the panel shows a `what_changed` tool row (summary "2 images"). The answer mentions
   the new terminal line and names the two times it compared. Asking the same about a screen you did
   not touch answers that nothing changed.

### 3B.7. Excluded apps are never recorded

1. **Setup:** rolling memory on. A password manager on the exclusion list installed (KeePass,
   Bitwarden or 1Password — any of the defaults), or add `notepad.exe` to the exclusion list in
   `settings.json` and restart.
2. **Action:** bring the excluded app to the front for **30 seconds**, with something recognisable in
   it. Then switch away and ask Scout: `what was on my screen 15 seconds ago?`
3. **Expected:** the answer does not describe the excluded app's contents. It either describes an
   older moment (with its time) or another display, or says nothing was recorded for that moment.

### 3B.8. Pause stops recording and clears it _(acceptance 3)_

1. **Setup:** rolling memory on for at least a minute; red dots visible.
2. **Action:** press the pause hotkey `Ctrl+Shift+Alt+P`. Then ask Scout:
   `what was on my screen thirty seconds ago?`
3. **Expected:** the red dots **disappear** and the grey paused eye appears. The answer says nothing is
   remembered — memory starts empty after a pause — and does not describe the screen from before the
   pause.
4. **Action:** press `Ctrl+Shift+Alt+P` again, wait 10 seconds, ask the same question.
5. **Expected:** the red dots **come back**. The answer describes only the last few seconds since the
   resume, and says memory does not reach back thirty seconds.

### 3B.9. Quit and restart: the buffer is empty _(acceptance 4)_

1. **Setup:** rolling memory on for at least two minutes.
2. **Action:** quit Tagalong from the tray. Check `%APPDATA%\Tagalong`: no new frame or image file is
   there. Start it again, wait 10 seconds, and ask Scout: `what was I doing five minutes ago?`
3. **Expected:** no image files on disk. After the restart the answer says memory only reaches back
   a few seconds (since the app started) — nothing from before the restart. The red dots are back
   because the setting is still on.

### 3B.10. Watch a long command finish _(acceptance 2, text only)_

1. **Setup:** Scout on OpenRouter + Claude, **Watch check model** empty (so checks run on
   `anthropic/claude-haiku-4.5`). Open `cmd` and keep it on your main screen.
2. **Action:** in `cmd`, run `ping -n 45 127.0.0.1 && echo BUILD DONE` (about 45 seconds). While it
   runs, press `Ctrl+Shift+Space` and ask Scout: `tell me when this command finishes`.
3. **Expected:**
   - Scout replies briefly that it is watching. A blue **Watching** chip appears in the panel:
     `Watching Scout: "…finishes" … 0/60 checks · anthropic/claude-haiku-4.5` with a **Stop** button.
     Scout's avatar shows a ⏱ mark.
   - While ping prints a line every second the check count stays at or near **0**: the screen keeps
     changing, so no check is made.
   - Within **10 seconds** of `BUILD DONE` appearing: a card from Scout with an ⏰ heading
     ("watching for …") and a one-sentence reason, a Windows notification "Tagalong — a watch fired",
     a red **!** on Scout's avatar, and the chip disappears. The panel comes up if it was hidden.
   - The chip's count before it vanished was a **handful** (1–3), not dozens.
   - Nothing is spoken (Phase 3 is not built).
4. **Action:** click Scout's avatar. **Expected:** the red **!** goes away.

### 3B.11. Stop a watch

1. **Setup:** start a watch as in 3B.10 with a command that never ends: `ping -t 127.0.0.1`.
2. **Action:** click **Stop** on the Watching chip. Then press `Ctrl+C` in `cmd`.
3. **Expected:** the chip disappears at once and no card appears afterwards — stopping is final. The
   ⏱ mark on Scout's avatar goes.

### 3B.12. At most three watches at once

1. **Setup:** three terminals each running `ping -t 127.0.0.1`.
2. **Action:** ask Scout to watch each one ("tell me when this stops"), one after another, then a
   fourth time.
3. **Expected:** three Watching chips. The fourth request is refused: Scout says it is already watching
   three things, the most at once, and that one can be stopped from its chip. Stop all three.

### 3B.13. A watch times out

1. **Setup:** `ping -t 127.0.0.1` running.
2. **Action:** ask Scout: `watch this terminal for the word FINISHED, but give up after one minute`.
3. **Expected:** a chip appears. About a minute later it disappears and the panel shows a grey line
   saying nothing matched before the timeout. No card, no notification.

### 3B.14. A watch that runs out of checks

1. **Setup:** in Settings set **Checks per watch** to **2**, Save (no restart). In `cmd` run
   `for /l %i in (1,1,50) do @(echo step %i & timeout /t 12 >nul)` — a line every 12 s.
2. **Action:** ask Scout: `tell me when this prints step 99`.
3. **Expected:** the chip counts `1/2`, then `2/2` checks as lines appear, then disappears with a line
   saying it checked 2 times without seeing it. Set **Checks per watch** back to **60**.

### 3B.15. A per-pet watch check model

1. **Setup:** Settings, Scout's **Watch check model**: type `anthropic/claude-haiku-4.5` explicitly
   (or another small model from the list). Save.
2. **Action:** reopen Settings; then start a watch as in 3B.10.
3. **Expected:** the box still holds the model you typed. The Watching chip names that model. Clear the
   box and Save: the placeholder default is used again on the next watch.

### 3B.16. A watch on Token Factory with Nemotron 3 Nano as the check model _(hackathon demo)_

_This test changes the test configuration on purpose._

1. **Setup:** store a **Token Factory API key** (Settings, Save). Set Scout to **Provider**
   Token Factory, **Model id** `nvidia/nemotron-3-super-120b-a12b`, **Vision model id**
   `nvidia/Nemotron-Nano-V2-12b`, **Watch check model** empty. Confirm that
   `nvidia/nemotron-3-nano-30b-a3b` appears in the live model list Scout's note mentions; if Token
   Factory names Nemotron 3 Nano differently, type the listed id into **Watch check model** and note
   the difference in Notion Issues. Click Save.
2. **Action:** in `cmd` run `ping -n 45 127.0.0.1 && echo BUILD DONE`, keep that window in front, and
   ask Scout: `tell me when this command finishes`.
3. **Expected:**
   - The Watching chip names **`nvidia/nemotron-3-nano-30b-a3b`** as the check model.
   - Within 10 seconds of `BUILD DONE`, the card, notification and avatar alert of 3B.10 appear, with
     a reason that quotes or describes the terminal's last line — Nano read the terminal's text, since
     it cannot see pictures.
   - In the Token Factory usage page, the watch's calls are on Nemotron 3 Nano (a handful), not on
     Nemotron 3 Super.
   - If `cmd` publishes no text to the accessibility tree on your machine, the check falls back to a
     picture on `nvidia/Nemotron-Nano-V2-12b`; the watch still fires. Note which one happened.

### 3B.17. Estimated image tokens in the sight bar

1. **Setup:** any pet; the panel closed.
2. **Action:** press `Ctrl+Shift+Space` (no picture), then press **Look at screen** in the sight bar,
   reading the sight bar each time.
3. **Expected:** no token estimate with the key alone. After **Look at screen** the bar shows
   `~N image tokens` where N is about width × height ÷ 750 of the screenshot named beside it (a
   1568×882 shot shows about 1,844).

## Phase 7: onboarding and installer

Covers the setup wizard (task 69) and the Windows installer (task 71). The wizard tests run from
source or installed; 7.12 onward need the installer.

**Test configuration.** [OpenRouter + Claude](#openrouter--claude-the-default-for-this-guide), plus a
Token Factory key for 7.6.

**Before you start:** quit Tagalong and rename `%APPDATA%\Tagalong` to `Tagalong.before-phase-7`, so
the next start is a fresh install. Rename it back at the end to keep your history.

### 7.1. The wizard opens on a fresh install

1. **Setup:** the fresh profile.
2. **Action:** start Tagalong (`pnpm dev:desktop`, or the installed app).
3. **Expected:** a window titled **Welcome to Tagalong** opens in the middle of the screen, reading
   "Step 1 of 7". The pets and the tray icon are there behind it.

### 7.2. Welcome states what Tagalong does and the privacy promise

1. **Setup:** 7.1.
2. **Action:** read the first step.
3. **Expected:** a paragraph on what Tagalong does, then **The privacy promise** with six points:
   nothing read until you ask, screenshots not written to disk, password managers never captured, keys
   in the OS keychain, requests only to the chosen provider, one key pauses sight. Buttons: **Skip
   setup** and **Next**.

### 7.3. The provider step will not continue without a key

1. **Setup:** click **Next**.
2. **Action:** with every key box empty, click **Next**. Then click **Get an API key from OpenRouter**.
3. **Expected:** three cards — OpenRouter, Nebius Token Factory, Anthropic — each with a key box and a
   **Get an API key from …** button. **Next** shows the red line "Paste an API key for at least one provider, or
   press Skip setup…" and stays on the step. **Get an API key from OpenRouter** opens
   `https://openrouter.ai/keys` in your default browser, not inside Tagalong.

### 7.4. A pasted key fills the crew step with the live model list

1. **Setup:** 7.3.
2. **Action:** select the **OpenRouter** radio, paste your OpenRouter key, click **Next**.
3. **Expected:** "Step 3 of 7 — Meet your crew" with three sections — 🔎 Scout, ✒️ Ink, ⚡ Bolt — each
   with **Provider** OpenRouter and a Claude model id already filled in (`anthropic/claude-sonnet-5`
   for Scout and Ink, `anthropic/claude-haiku-4.5` for Bolt). The note under each says "N models from
   OpenRouter" (N in the hundreds), and the model box offers them as you type.

### 7.5. The crew picks are saved

1. **Setup:** 7.4.
2. **Action:** change Bolt's model to another Claude id from the list. Click **Next**. Open Settings
   from the tray.
3. **Expected:** the wizard moves on with no error. Settings shows Scout, Ink and Bolt on OpenRouter
   with the models from the crew step, and every **Vision model id** empty. The OpenRouter key box says
   "one is stored".

### 7.6. A Nemotron pet gets its vision model automatically _(hackathon demo)_

1. **Setup:** in the wizard, click **Back** to the provider step.
2. **Action:** paste a Token Factory key too, click **Next**. On the crew step set Scout to **Nebius
   Token Factory**: the model fills in as `nvidia/nemotron-3-super-120b-a12b`. Set Bolt to Token Factory
   (`nvidia/Nemotron-Nano-V2-12b`). Leave Ink on OpenRouter. Click **Next**, then open Settings.
3. **Expected:** the crew step's notes say "N models from Token Factory" for Scout and Bolt. Settings
   shows Scout with **Vision model id** `nvidia/Nemotron-Nano-V2-12b` (set by the wizard), Bolt with an
   empty vision model (its model already sees), and Ink unchanged.

### 7.7. The hotkeys step matches Settings

1. **Setup:** the wizard on "Three keys to remember".
2. **Action:** compare it with the hotkey boxes in Settings.
3. **Expected:** two keys — `Ctrl + Shift + Space` (Ask) and `Ctrl + Shift + Alt + P` (Pause
   sight) — the same as Settings, plus a line on `@Ink` handoff and `/crew`. If you rebound a key earlier, the wizard shows
   your binding.

### 7.8. Rolling memory from the wizard

1. **Setup:** the wizard on "Rolling memory (optional)".
2. **Action:** tick **Turn on rolling memory**, set minutes to `5`, click **Next**. Then go **Back**,
   set minutes to `0`, click **Next**.
3. **Expected:** after the first **Next** a small red dot appears on every pet within a second, and
   Settings → Awareness shows rolling memory on with 5 minutes. The second **Next** is refused with
   "Rolling memory keeps between 1 and 30 minutes." Set it back to 5 (or untick it) to continue.

### 7.9. The Chrome extension step

1. **Setup:** the wizard on "Chrome extension (optional)".
2. **Action:** read the folder named in step 2 and click **Show folder**. Click **Copy token**.
3. **Expected:** installed: the folder is `…\Programs\Tagalong\resources\extension` and Explorer
   opens on it, holding `manifest.json`. From source with the extension built: `apps\extension\dist`;
   not built: the step says how to build it instead of naming a folder. The token matches **Settings →
   Browser extension**. Loading that folder unpacked and pairing with the token works as in 6.1–6.3.

### 7.10. A first answer without a terminal _(task 69 acceptance)_

1. **Setup:** the wizard on "You are set". No restart since 7.1.
2. **Action:** click **Ask Scout something**. Ask "What can you do?".
3. **Expected:** the wizard closes, the panel opens beside the pets on Scout, and the answer streams
   and completes, labelled with Scout's model. No error about a missing key, and no restart was needed
   for the key pasted in 7.4.

### 7.11. Skip, and the wizard does not come back by itself

1. **Setup:** quit Tagalong, delete `%APPDATA%\Tagalong` again, start it.
2. **Action:** click **Skip setup** on the first step. Quit and start Tagalong again.
3. **Expected:** the wizard closes at once. On the next start it does not open. The pets are on the
   fresh-install defaults (Scout and Bolt on Token Factory, Ink on OpenRouter).

### 7.12. Rerun the wizard from the tray and from Settings

1. **Setup:** 7.11 done, an OpenRouter key stored in Settings.
2. **Action:** tray → **Setup wizard**. Go to the provider step and click **Next** without typing a key.
   Close the wizard with the window's X. Then Settings → **Run the setup wizard again**.
3. **Expected:** the wizard opens both times. The provider step lets you through because a key is
   already stored ("stored — type to replace"). On the crew step, pets already on a provider with a key
   keep their current model; the others move to your main provider. Closing with X keeps what earlier
   steps saved.

### 7.13. Build the Windows installer

1. **Setup:** Windows with Node.js 22 and pnpm 10; a clean checkout of this branch; `pnpm install`.
2. **Action:** `pnpm package:win` from the repository root.
3. **Expected:** it ends without errors and `apps\desktop\release\Tagalong-Setup-0.0.0-x64.exe` exists
   (about 125 MB). The log shows "fetching the get-windows binding for win32-x64" succeeding and
   "skipped dependencies rebuild reason=npmRebuild is set to false". In
   `apps\desktop\release\win-unpacked\resources` there are `app.asar`, `app.asar.unpacked` (holding
   `better-sqlite3\prebuilds\win32-x64.node` and `get-windows\lib\binding\napi-9-win32-unknown-x64`)
   and `extension`.

### 7.14. Install on a fresh Windows machine _(Phase 7 acceptance 1)_

1. **Setup:** a Windows machine or Windows Sandbox that has never run Tagalong, with no Node.js and no
   terminal open. Copy the installer from 7.13 onto it.
2. **Action:** double-click the installer. If SmartScreen appears, **More info → Run anyway**. Keep the
   default install folder, finish, and complete the wizard with an OpenRouter key through 7.10.
3. **Expected:** no administrator prompt. Tagalong installs to
   `%LOCALAPPDATA%\Programs\Tagalong`, adds Start menu and desktop shortcuts, and starts when the
   installer finishes. The wizard opens, and a first answer arrives — all without a terminal.

### 7.15. Native modules work in the installed app _(task 71 acceptance)_

1. **Setup:** the installed app from 7.14.
2. **Action:** (a) ask Scout "remember that my favourite colour is teal", quit from the tray, start
   Tagalong from the Start menu, ask "what is my favourite colour?". (b) Put Notepad beside a browser,
   click into Notepad, press `Ctrl+Shift+Space` and ask "which app am I in? Take a screenshot".
3. **Expected:** (a) "teal" — conversations and memories persist, so SQLite (`better-sqlite3`) loaded
   from the packaged app. (b) The sight bar names Notepad and the screenshot is of the Notepad window,
   not the whole screen — the active-window binding (`get-windows`) loaded. Selecting text and pressing
   `Ctrl+Shift+Space` shows the selection, so the selection helper (`libnut`) loaded.

### 7.16. Uninstall keeps your data; reinstall picks it up

1. **Setup:** the installed app with a conversation in it.
2. **Action:** quit Tagalong, uninstall it from **Settings → Apps**, then install it again.
3. **Expected:** the uninstall removes the program folder and shortcuts but leaves
   `%APPDATA%\Tagalong`. After reinstalling, the wizard does not open (it was finished), and the pets,
   keys and history are as before.

## Settings

### S.1. How Scout thinks shows the real brain and sign-in

1. **Setup:** Claude Code installed and signed in (`claude auth status` says `"loggedIn": true`);
   Scout on the Claude sign-in with Haiku.
2. **Action:** open Home → Settings.
3. **Expected:** the first card reads **Your Claude sign-in · Haiku** with a **Signed in** chip (a
   tick and the words). **Change it on the Scout page** opens Home's Scout page. Move Scout to
   OpenRouter there and come back: the card reads **OpenRouter · <model>** with **Key stored**.

### S.2. Signed out, and Check again

1. **Setup:** run `claude auth logout` in a terminal. Scout on the Claude sign-in.
2. **Action:** open Settings. Then run `claude auth login`, and click **Check again**.
3. **Expected:** first a **Signed out** chip with "Run claude in a terminal and sign in", and the
   buttons **Check again** and **Use an API key instead**. After signing in, **Check again** turns it
   into **Signed in**. No model call is made (Activity stays empty).

### S.3. No Claude Code: pick a service and paste a key

1. **Setup:** a machine (or PATH) without `claude`. Scout on the Claude sign-in.
2. **Action:** open Settings, pick **OpenRouter**, paste a key, click **Save**.
3. **Expected:** before saving, "Scout needs a brain to think with" and three services. After Save
   the card reads **OpenRouter · anthropic/claude-haiku-4.5** (the recommended model) with **Key
   stored**, and Scout answers the next question on OpenRouter.

### S.4. API keys: add, replace, remove

1. **Setup:** Settings → **Advanced** (closed until you open it).
2. **Action:** **Add key** on Token Factory, paste a key, Save. Then **Remove key** on it.
3. **Expected:** after Save the row says **Key stored** and offers **Replace key**. **Remove key**
   says "Token Factory key removed." and the row goes back to **No key**. There is no row for the
   Claude sign-in.

### S.5. A refused value inside Advanced opens Advanced

1. **Setup:** Settings, Advanced closed.
2. **Action:** open Advanced, type `40` in **Watches at once**, close Advanced, Save.
3. **Expected:** "Not saved. Watches at once must be a whole number between 1 and 10." Advanced opens
   by itself, the field is outlined, focused and has the same sentence under it.

### S.6. A shortcut another app uses

1. **Setup:** another app holding Ctrl+Shift+Space (or type an accelerator Windows refuses).
2. **Action:** Save that combination as the ask key.
3. **Expected:** the message names the combination under the shortcut fields and the ask field is
   outlined. Fixing it and saving clears both.

### S.7. The ⓘ notes

1. **Action:** press each ⓘ in turn.
2. **Expected:** each opens its note inline below, the button shows pressed (`aria-expanded`), and
   opening another closes the first. The blind spot chips match the list in [privacy](../privacy.md).

### S.8. Experts have no default folder

1. **Setup:** an expert saved by an older build with a default folder.
2. **Action:** open it in Home → Experts and Save; then ask Scout for a coding task from a window
   with no project in its title.
3. **Expected:** the form has no folder box, and **Let it edit files by default** and **On** are
   switches. The hand-off card offers no remembered default and opens the folder picker.

## Greeting

### G.1. The intro after Welcome, in three beats

1. **Setup:** a fresh install (empty `%APPDATA%\Tagalong`).
2. **Action:** finish Welcome with **Start**.
3. **Expected:** Scout's bubble opens beside it without taking the keyboard and types in "Hi, I'm
   Scout. I sit in the corner of your screen and keep an eye on what you're working on, never on
   passwords or private windows." **Next** shows "Ask me about whatever you're on. When it needs
   real work, I brief an expert, like Claude Code, and bring the answer back." **Next** again shows
   "Press Ctrl+Shift+Space anytime." with **Try it now** (focused) and **Got it**. Three dots show
   which beat you are on. Tab reaches every button.
4. **Reduced motion:** with Windows Settings → Accessibility → Visual effects → **Animation effects**
   off, each beat appears whole, with no typing.

### G.2. A later launch says one quiet line

1. **Setup:** an install that finished Welcome. Quit Tagalong.
2. **Action:** start Tagalong again, and keep typing in another window.
3. **Expected:** one short line appears beside Scout (for example "Morning. I'm here when you need
   me."); your typing is not interrupted. It fades after about seven seconds. Pointing at it keeps it;
   clicking it opens the bubble to ask; × closes it. With no brain set up, or one that fails, a
   handwritten line appears instead. Nothing is captured (no capture dot, nothing in Activity).
4. **After a hand-off:** finish a hand-off to Claude Code, quit, start again. The line mentions
   Claude Code.

### G.3. The greeting can be switched off

1. **Action:** Settings → Privacy → **Say hello when Tagalong opens** → Off, Save. Restart.
2. **Expected:** Scout docks and says nothing. The ⓘ note says the hello reads no screen.

### G.4. Scout knows your name

1. **Action:** on a fresh install, type `Nadeem` in Welcome's **What should I call you?** and
   **Start**.
2. **Expected:** the intro's first beat reads "Hi Nadeem, I'm Scout. …". Restart with the brain
   signed out: the handwritten line reads like "Morning, Nadeem. I'm here when you need me."
   Answers rarely use the name.
3. **Action:** Settings → **You** → clear the box, Save. Restart.
4. **Expected:** the line has no name. Skipping the field in Welcome gives "Hi, I'm Scout." as
   before.

## Keeping an eye on things

On by default. Not active under `TAGALONG_FAKE_PROVIDERS=1` unless `TAGALONG_KEEP_AN_EYE=1` is set.

### K.1. A failed build gets one line

1. **Setup:** a real brain set up; the bubble closed; nothing said in the last ten minutes.
2. **Action:** in a terminal, run a command that fails, and give the window a title with "failed"
   in it (PowerShell: `$host.UI.RawUI.WindowTitle = 'npm test failed'`). Keep typing elsewhere.
3. **Expected:** within about five seconds one short line appears beside Scout, about the failure,
   and your typing is not interrupted. It has **Not now** and fades after about twelve seconds. No
   screenshot is taken. If the summaries model sees nothing useful, nothing appears, which is fine.

### K.2. Settling on a new window

1. **Action:** open a document or page you have not opened this session and stay on it for 30 s.
2. **Expected:** usually nothing. At most one line, and never a second one about the same window.

### K.3. The limits

1. **Action:** after a line, cause another failure within ten minutes.
2. **Expected:** nothing until ten minutes have passed since the last line.
3. **Action:** press **Not now** on a line, then cause failures.
4. **Expected:** nothing for an hour.
5. **Action:** put a video full screen, or join a Teams, Zoom or Google Meet call, then cause a
   failure in a window behind it.
6. **Expected:** nothing while the full-screen window or the call is in front.

### K.4. Blind spots and the switch

1. **Action:** add `*failed*` to your exclusion list, then cause a failure whose title matches it.
2. **Expected:** nothing; that window is never read.
3. **Action:** Settings → Privacy → **Keep an eye on things** → Off, Save.
4. **Expected:** no further lines; the window list is no longer taken. The ⓘ note explains what is
   followed and when a window is read.

### K.5. Hand it over

1. **Setup:** Claude Code switched on as an expert.
2. **Action:** cause a failure that an expert could fix. When a line with **Hand it over** appears,
   press it.
3. **Expected:** the hand-off card opens with the task and the window title; nothing runs until you
   press **Send**.

## Voice: Scout talks

Run from source **without** `TAGALONG_FAKE_TTS` (it makes every line silent), with speakers on. The
fake brain is fine: `TAGALONG_FAKE_PROVIDERS=1` keeps the answers free. The first line downloads the
voice model (about 90 MB) into `%APPDATA%\Tagalong\voice`; ElevenLabs (V.6) bills your own account.

### V.1. Scout reads an answer aloud

1. **Setup:** a fresh profile, so the voice model is not downloaded yet.
2. **Action:** ask Scout anything in the bubble.
3. **Expected:** the answer is spoken by the system voice (a British male voice such as Microsoft
   George if installed) while the model downloads; three bars beside × move with the voice. A
   later answer is spoken by the Kokoro voice. With Windows' reduce-animations setting on, the bars
   hold still.

### V.2. Only a short form is spoken

1. **Action:** ask for "a bulleted list of five fruits, then a code sample".
2. **Expected:** Scout says the sentence before the list and "The rest is in the bubble." No list
   item or code is read.

### V.3. Stopping

1. **Action:** while Scout speaks, press `Ctrl+Shift+Alt+M`; on the next answer click the bars; on the
   next press Escape.
2. **Expected:** speech stops at once each time, and nothing queued is spoken afterwards.

### V.4. The hello, an expert finishing and a watch

1. **Action:** finish Welcome and step through the intro with **Next**; restart Tagalong; hand a
   task to Claude Code; start a watch ("tell me when this finishes").
2. **Expected:** each intro beat is spoken as it appears; the line on a later launch is spoken;
   "Claude Code has finished." and the start of its answer are spoken; the watch's message is
   spoken when it fires; a line from keeping an eye on things (K.1) is spoken, and its × stops it.

### V.5. Settings → Voice

1. **Action:** pick Fable and press **▶ Preview**; move the speed slider and preview again; switch
   **Scout talks** off, Save, and ask a question.
2. **Expected:** each preview plays in the chosen voice and speed before saving; with Scout talks off
   the answer is silent, and Preview still plays.

### V.6. ElevenLabs (your own key)

1. **Action:** in Settings → Advanced → ElevenLabs voice, paste your key and a voice ID from your
   ElevenLabs library; Save; ask a question. Then remove the key.
2. **Expected:** the answer is spoken in that voice (the ElevenLabs history shows only the spoken
   words). With the key removed, or a wrong voice ID, Scout speaks with the local voice again.

## Talk to Scout

Run from source **without** `TAGALONG_FAKE_STT` and `TAGALONG_FAKE_TTS`, with a microphone and
speakers. The fake brain is fine for T.1 to T.6; T.7 needs a real one. The first spoken question
downloads the speech model (about 80 MB) into `%APPDATA%\Tagalong\voice`. With
`TAGALONG_FAKE_STT=1` every question is heard as "What am I looking at?" and no microphone is used.

### T.1. Hold to talk

1. **Setup:** a fresh profile, so the speech model is not downloaded yet.
2. **Action:** hold `Ctrl+Shift+Alt+Space`, say "what am I looking at?", let go.
3. **Expected:** the bubble opens with a pulsing dot and "Listening…" while the key is held, and a
   note that the first time downloads the speech model. On letting go it says "Turning that into
   text…", then shows what it heard and answers. Windows shows the microphone in use only while
   the key is held.

### T.2. Spoken answers start early and sound spoken

1. **Setup:** a real brain (Claude or another provider).
2. **Action:** hold the key and ask "what's a good way to name a test?".
3. **Expected:** Scout starts speaking after the first sentence arrives, before the answer finishes
   streaming. The answer is a few short sentences with contractions, no list read aloud, at most
   one question back. Any code or list shows in the bubble and is not spoken.

### T.3. Barge-in

1. **Action:** ask a typed question that gets a long answer; while Scout speaks, hold the talk key.
2. **Expected:** Scout stops speaking at once, the bubble listens, and the new spoken question is
   answered.

### T.4. Reply, never an open mic

1. **Action:** after a spoken answer finishes, wait ten seconds without touching anything.
2. **Expected:** the bubble shows "Hold Ctrl+Shift+Alt+Space to reply". The microphone does not open
   (no microphone icon in the Windows tray). Holding the key again continues the same conversation.

### T.5. The mic button

1. **Action:** click the mic beside × in the bubble, speak, click it again.
2. **Expected:** the mic button turns gold while listening ("Stop listening"); the second click sends
   the question. Closing the bubble while listening stops the microphone and sends nothing.

### T.6. Nothing said, and the microphone setting

1. **Action:** hold the key for a second in silence and let go. Then in Settings → Voice pick another
   microphone, Save, and talk again. Then turn off microphone access for desktop apps in Windows
   Settings and talk again.
2. **Expected:** silence: "I didn't catch that." and nothing is asked. The picked microphone is used.
   With access off, the bubble says the microphone could not be opened.

### T.7. Confirmations in a spoken turn

1. **Setup:** a connected app (see [Connections](#connections-your-apps-over-mcp)).
2. **Action:** hold the key and ask Scout to make a change in that app.
3. **Expected:** the confirm card appears in the bubble and Scout says to check the card rather than
   reading it out. Nothing changes until **Allow once**.

### T.8. Settings → Voice

1. **Action:** change **Talk to Scout** to another combination, Save, and hold the new key.
2. **Expected:** the new key works at once; the bubble's reply hint names it. A key another app owns is
   reported in Shortcuts and the field is marked.

## Demo run: the hackathon story

A short end-to-end run of the story the hackathon demo tells. Run it on the installed app, with an
OpenRouter key and a Token Factory key at hand. Tick each line.

- [ ] **Install and set up.** Install from the NSIS installer (7.14). In the wizard paste both keys;
      crew: Scout on Token Factory `nvidia/nemotron-3-super-120b-a12b`, Bolt on Token Factory
      `nvidia/Nemotron-Nano-V2-12b`, Ink on OpenRouter `anthropic/claude-sonnet-5`. Finish with **Ask
      Scout something**.
- [ ] **Nemotron on Token Factory.** Select a paragraph anywhere, press `Ctrl+Shift+Space`, ask Scout
      to explain it. The answer is labelled `Scout · nvidia/nemotron-3-super-120b-a12b`.
- [ ] **Vision routing.** Click Scout and ask "what is on my screen?". It describes
      the screen with no "cannot see images" warning: Super handed the picture to Nemotron Nano 2 VL
      (the Token Factory usage page shows the Nano VL call).
- [ ] **Crew roundtable on mixed models.** Type `/crew What should I build next?`. Three answers
      labelled with three models from two providers, each reacting to the others, then a synthesis by
      Scout; the footer reads "4 model calls".
- [ ] **Handoff.** Type `@Ink turn that into a short announcement`. A handoff bubble, then Ink's draft
      on Claude.
- [ ] **Watch mode on Nemotron Nano.** In `cmd` run `ping -n 45 127.0.0.1 && echo BUILD DONE`, then ask
      Scout "tell me when this command finishes". The Watching chip names
      `nvidia/nemotron-3-nano-30b-a3b`; within ten seconds of `BUILD DONE` a card and a Windows
      notification arrive after a handful of checks.
- [ ] **Chrome.** In the side panel on an article, ask Scout "summarise this page". The summary is of
      that article.
- [ ] **Privacy.** Press `Ctrl+Shift+Alt+P`: the pets' eye turns grey and a look is refused. Press it
      again to resume.

## Connections: your apps over MCP

These use real apps and a real provider, so they are yours to run. Scout must think with a provider
that calls tools (your Claude sign-in or OpenRouter + Claude).

### C1. Connect Notion

- [ ] Home → **Connections** → Popular → **Connect Notion**. Your browser opens Notion's sign-in;
      the page says **Finish signing in to Notion in your browser.**
- [ ] Approve in Notion. The browser shows "You are signed in"; Home lists Notion as **Connected**
      with its tools, each **Reads** or **Asks first**.
- [ ] Restart Tagalong. Notion connects again with no browser.

### C2. Read with Notion

- [ ] Ask Scout "look at my launch plan in Notion" (a page you have). Scout answers from the page with
      no card. Activity shows "Scout read Notion" with the tool name.

### C3. A change asks first

- [ ] Ask Scout "add a page in Notion called Tagalong test". The bubble comes up with a card: Notion,
      what will change, the title. Nothing has changed in Notion yet.
- [ ] Press **Cancel**. Scout says nothing was changed; Activity shows "Scout did not change Notion".
- [ ] Ask again and press **Allow once**. The page appears in Notion; Activity shows "Scout changed
      Notion".
- [ ] Ask again and leave the card for two minutes. Scout says you did not answer and nothing changed.

### C4. GitHub with a token

- [ ] **Connect GitHub**, paste a personal access token (read-only is enough), **Connect**. GitHub
      shows **Connected**.
- [ ] Ask "any reviews waiting for me on GitHub?". Scout lists them.
- [ ] Settings files and `tagalong.db` do not contain the token (search the data folder for it).

### C5. Found on this PC

- [ ] With a server set up in Claude Code (`claude mcp add ...`), it is listed under **Found on this
      PC** with "From Claude Code". **Use** adds it; one with a key in its env asks for the key first.
- [ ] A server already connected is not listed again.

### C6. Add a connector

- [ ] **Add a connector** → **A command on this PC**, name `Files`, command
      `npx -y @modelcontextprotocol/server-filesystem C:/Users/<you>/Documents` → **Add**. It connects
      and lists its tools.
- [ ] An address that is not https is refused with a plain message.

### C7. Failures stay plain

- [ ] Add a command that does not exist. Its row says **Not working** and why; Scout still answers
      other questions.
- [ ] Switch a connection **Off**. Scout no longer uses it, and says so if you ask for it.
- [ ] **Disconnect** → **Disconnect ... and delete its sign-in**. It is gone; connecting again asks
      you to sign in again.

## Routines

Scout does things on its own, at a time or when something happens. Most of this runs on the fake
provider (`TAGALONG_FAKE_PROVIDERS=1`); the steps marked _(real brain)_ need Scout on a real provider,
and Morning papers needs Claude Code installed and signed in.

### R1. Home → Routines, from a template

1. Open Home and choose **Routines**. It says there are none yet.
2. **New routine** → **Morning papers**. Name, **Weekdays** at **08:00**, the instruction and
   **May hand to: Claude Code** are filled in. Type a topic, such as `AI agents`.
3. **Save**. The list shows Morning papers, **On**, "Not run yet" and **Next:** tomorrow's (or
   today's) 08:00.

### R2. Run now, and the result

1. **Run now** on Morning papers. Within a minute a quiet line appears beside Scout,
   "Morning papers: ...".
2. Click the line: the bubble opens on the full answer. Ask "explain the second one simply"
   _(real brain)_: Scout answers from the same conversation.
3. **Activity** shows "Scout ran Morning papers", and a Claude Code hand-off with no project.
   Routines shows "Last run: done" with **See in Activity**.

### R3. Ask Scout for one _(real brain)_

1. Ask: "every weekday at 8, give me new papers on AI agents and explain the best one simply".
2. A routine card appears: Name, When "Weekdays at 08:00", What, Uses (with "May hand to: Claude
   Code, read-only, no project" when Scout chose to hand off), Result goes to.
3. Before you press anything, Home → Routines shows nothing new. **Cancel**: still nothing.
4. Ask again and press **Save**. The card says "Saved. Run it now to test?". **Run it now** runs it.
5. Ask "pause morning papers". A card says **Pause**; only after you press it does the switch in
   Home read **Off**. Then "delete morning papers", and **Delete**.
6. Ask again and press **Edit** on the card: Home opens on Routines with it in the form. Change the
   name and **Save**.

### R4. Triggers

1. Make a **Blank** routine, **When an app or site appears**, app `Notepad`, What "Say hi in one
   line". Save. Open Notepad: within 15 seconds the line appears. It does not repeat while Notepad
   stays open; close and reopen it, and it runs again.
2. Add `notepad.exe` to your exclusions (Settings → Privacy). Reopen Notepad: nothing runs.
3. A routine **When Tagalong opens** runs once at each launch.
4. **When an expert finishes**: hand Claude Code a task; when it finishes, the routine runs with its
   answer.
5. **When a watch fires**: start a watch ("tell me when this finishes"); when it fires, the routine
   runs.

### R5. Missed runs and quiet times

1. Make a routine **Every day** at a time two minutes ahead, then put the PC to sleep for five
   minutes. On waking, it runs once and its line says "(ran late)".
2. Quit Tagalong before a routine's time and start it after: it runs once, late. Quit and start
   again: it does not run again.
3. Start a Teams or Zoom call, or a full-screen video, and **Run now**: nothing shows until the call
   or the full screen ends, then the line appears.

### R6. Where the result goes

1. Edit a routine: untick **In Scout's bubble**, tick **Windows notification**. **Run now**: a
   notification arrives and no line shows. Click it: the bubble opens on the result.
2. Tick **Read aloud**: the result is spoken (with Scout talks on in Settings → Voice).
3. Leave the bubble open and **Run now** on a bubble-only routine: the line does not cover the open
   bubble; a notification carries it instead.

### R7. Consent

1. A routine with **May hand to: No one without asking** that needs an expert shows the normal
   hand-off card and waits for **Send**.
2. A routine whose instruction would change something in a connected app (for example "create a
   Notion page with today's plan") shows **Allow once** every time it runs _(real brain)_.
3. A routine that reads a connected app (for example GitHub reviews) reads it without asking
   _(real brain)_.
4. A routine with **May hand to: Claude Code** starts Claude Code at once only for its first
   hand-off in a run; if Scout hands off again in the same run, the second one shows the normal
   hand-off card _(real brain)_.
5. In a project folder whose `.claude/settings.json` has a hook (for example a `PreToolUse` hook
   that writes a file), confirm a hand-off to Claude Code there: the hook does not run, and none
   of your own MCP servers show up in the expert's steps.

## Not in this build

These appear in the plan but are not built; do not test them here.

- **Cloud speech to text and a wizard step.** Talk to Scout turns speech into text on this
  computer only (no ElevenLabs Scribe), and Welcome has no microphone or speaker step. A pet's reply
  style and voice id save but change nothing; Scout's voice is set in Settings → Voice.
- **Per-pet tool grants (Phase 5).** Connected apps work (see
  [Connections](#connections-your-apps-over-mcp)), but there is no per-pet allow list and no
  "always allow": every change asks.
- **macOS and Linux platform code (tasks 67, 68).** The app stops at launch on both; the dmg, AppImage
  and deb configs exist but are unverified.
- **Cost dashboard (task 72).** The panel counts model calls per run and the sight bar estimates image
  tokens, but there is no per-pet, per-day usage view or price table.
