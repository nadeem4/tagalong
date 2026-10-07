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
2. **Action:** press `Ctrl+Shift+S` and ask "what is on my screen?".
3. **Expected:** the answer describes the screen, with **no** "cannot see images" warning.

### H4. OpenRouter + Claude: an image inside a tool result

1. **Setup:** as H2.
2. **Action:** press `Ctrl+Shift+Alt+S` and ask Scout to zoom in on something small.
3. **Expected:** Scout calls `look_closer`; the tool result shows as "1 image"; the answer describes
   the zoomed detail.

### H5. OpenRouter + Claude: a tool without an image

1. **Setup:** as H2.
2. **Action:** ask "which windows do I have open?".
3. **Expected:** Scout calls `list_windows` and answers from the result.

### H6. Token Factory + Nemotron

_Not the default configuration: this step uses Nebius Token Factory._

1. **Setup:** paste a key into **Token Factory API key**, Save, reopen Settings; the note
   says "models from Token Factory". Set Scout's **Provider** to Token Factory, **Model ID** to
   `nvidia/nemotron-3-super-120b-a12b`, **Vision model ID** to the Nemotron Nano 2 VL id from the
   live list (if it is not `nvidia/Nemotron-Nano-V2-12b`, correct `NEMOTRON_VISION_MODEL`). Save.
2. **Action:** (a) `Ctrl+Shift+Space` with a question; (b) `Ctrl+Shift+S`, "what is on my screen?";
   (c) `Ctrl+Shift+Alt+S`, ask to zoom in; (d) clear the vision model id, save, `Ctrl+Shift+S`.
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
uses a mixed crew on OpenRouter and Nebius Token Factory. Voice (Phase 3) is not built, so nothing in
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

1. **Setup:** Settings open.
2. **Action:** under **Conversation summaries**, pick **OpenRouter** and type a cheaper model id from
   the live list (for example `anthropic/claude-haiku-4.5`). Save. Then type only a model with the
   provider set back to "Each pet's own provider", and Save.
3. **Expected:** the first save says "Saved."; the second is refused with "The summarizer needs both a
   provider and a model — or leave both blank…". Clearing both boxes and saving is accepted.

### 4.18. Edit a pet

1. **Setup:** Settings open.
2. **Action:** for Bolt change **Name** to `Sparky`, **Emoji** to `🔧`, **Colour** to green, and add
   "Always answer in British English." to **Notes (optional, private)**. Save.
3. **Expected:** the desktop strip re-draws with 🔧 and a green underline; the panel header reads
   **🔧 Sparky** in green; a new question to Sparky is answered in British spelling. **Reply style**
   and **Voice id** save without error but change nothing audible (voice is Phase 3).

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

1. **Setup:** untick **Rolling memory**, Save.
2. **Action:** confirm the red dot is gone from every avatar, then ask Scout:
   `what was I doing two minutes ago?`
3. **Expected:** the dot disappeared on save. The answer says rolling memory is off and that it can be
   turned on in Settings under Awareness. Tick **Rolling memory** again and Save before continuing.

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
2. **Action:** press `Ctrl+Shift+Space` (no picture), then `Ctrl+Shift+S`, then `Ctrl+Shift+Alt+S`,
   reading the sight bar each time.
3. **Expected:** no token estimate with the text-only key. With `Ctrl+Shift+S` the bar shows
   `~N image tokens` where N is about width × height ÷ 750 of the screenshot named beside it (a
   1568×882 shot shows about 1,844). With `Ctrl+Shift+Alt+S` on two monitors it shows a larger N and
   `· 3 images` (the overview plus the focused display — more with **Every screen** chosen).

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
3. **Expected:** four keys — `Ctrl + Shift + Space` (Ask), `Ctrl + Shift + S` (Look),
   `Ctrl + Shift + Alt + S` (See everything), `Ctrl + Shift + Alt + P` (Pause sight) — the same as
   Settings, plus a line on `@Ink` handoff and `/crew`. If you rebound a key earlier, the wizard shows
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
   default folder, finish, and complete the wizard with an OpenRouter key through 7.10.
3. **Expected:** no administrator prompt. Tagalong installs to
   `%LOCALAPPDATA%\Programs\Tagalong`, adds Start menu and desktop shortcuts, and starts when the
   installer finishes. The wizard opens, and a first answer arrives — all without a terminal.

### 7.15. Native modules work in the installed app _(task 71 acceptance)_

1. **Setup:** the installed app from 7.14.
2. **Action:** (a) ask Scout "remember that my favourite colour is teal", quit from the tray, start
   Tagalong from the Start menu, ask "what is my favourite colour?". (b) Put Notepad beside a browser,
   click into Notepad, press `Ctrl+Shift+S` and ask "which app am I in?".
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

## Demo run: the hackathon story

A short end-to-end run of the story the hackathon demo tells. Run it on the installed app, with an
OpenRouter key and a Token Factory key at hand. Tick each line.

- [ ] **Install and set up.** Install from the NSIS installer (7.14). In the wizard paste both keys;
      crew: Scout on Token Factory `nvidia/nemotron-3-super-120b-a12b`, Bolt on Token Factory
      `nvidia/Nemotron-Nano-V2-12b`, Ink on OpenRouter `anthropic/claude-sonnet-5`. Finish with **Ask
      Scout something**.
- [ ] **Nemotron on Token Factory.** Select a paragraph anywhere, press `Ctrl+Shift+Space`, ask Scout
      to explain it. The answer is labelled `Scout · nvidia/nemotron-3-super-120b-a12b`.
- [ ] **Vision routing.** Press `Ctrl+Shift+S` and ask Scout "what is on my screen?". It describes
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

## Not in this build

These appear in the plan but are not built; do not test them here.

- **Voice (Phase 3).** No push to talk, no spoken answers, no microphone or speaker step in the
  wizard. Reply style and voice id save but change nothing; watch alerts are shown, not spoken.
- **Hands (Phase 5).** No MCP tools, no tool allowlists beyond the built-in perception and crew tools,
  no approval cards, no action log.
- **macOS and Linux platform code (tasks 67, 68).** The app stops at launch on both; the dmg, AppImage
  and deb configs exist but are unverified.
- **Cost dashboard (task 72).** The panel counts model calls per run and the sight bar estimates image
  tokens, but there is no per-pet, per-day usage view or price table.
