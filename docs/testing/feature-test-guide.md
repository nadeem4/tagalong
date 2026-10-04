# Tagalong feature test guide

Step-by-step manual tests for what each phase adds, written so someone who did not build the
feature can run it and know whether it passed.

**Test configuration.** Unless a step says otherwise, run every test with **OpenRouter and a Claude
model**: in the desktop app's Settings, store an OpenRouter API key, set the pet's **Provider** to
OpenRouter, pick a Claude model from the live list, and leave **Vision model ID** empty (on
OpenRouter every model sees). Launch with `pnpm dev:desktop` and without `TAGALONG_FAKE_PROVIDERS`.
Steps marked _fake provider_ need no key: launch with `TAGALONG_FAKE_PROVIDERS=1` instead.

Each step lists **Setup**, **Action** and **Expected**. A step passes only if everything under
Expected is true.

## Phase H: model providers

Covers the OpenAI-compatible provider, the OpenRouter and Token Factory presets, per-pet models and
vision routing (PR #22).

**Before you start:** launch without `TAGALONG_FAKE_PROVIDERS` (`pnpm dev:desktop`), then open
Settings from the tray.

### H1. OpenRouter key and live model list

1. **Setup:** an OpenRouter API key.
2. **Action:** paste it into **OpenRouter API key**, click Save, restart the app, reopen Settings.
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

1. **Setup:** paste a key into **Token Factory API key**, Save, restart, reopen Settings; the note
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
   (c) remove the key, restart, and ask.
3. **Expected:** (a) refused on save with a message naming the service; (b) back to the default;
   (c) the turn error "No … API key is stored. Add one in Settings." and the app keeps running.

## Phase 6: Browser Host

Covers the Chrome extension: build and load, pairing, the side panel, exact selections and page
text, the shortcut, the desktop hotkey in Chrome, disconnect and recovery, and the opt-in to read
any tab.

**Before you start:**

- Windows with Chrome 116 or newer, and the desktop app running (`pnpm dev:desktop`) with the test
  configuration above.
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
3. **Expected:** the header names that pet in its colour; the answer comes in its persona and is
   labelled with its name and model. Earlier messages stay on screen: the crew shares one timeline.

## Phase 4: Crew

Covers the default crew, memory and recall, conversation summaries, handoff, consult, the roundtable,
the crew strip, the pet editor and the model-call counter (tasks 44–51).

**Test configuration.** As the rest of this guide: **OpenRouter and a Claude model**. One test, 4.13,
uses a mixed crew on OpenRouter and Nebius Token Factory. Voice (Phase 3) is not built, so nothing in
this phase speaks; every "voice" in the phase page is checked as text.

**Before you start:**

1. Quit Tagalong. Rename `%APPDATA%\Tagalong` to `Tagalong.before-phase-4` so the app starts as a
   fresh install (rename it back afterwards to keep your old history).
2. Launch with `pnpm dev:desktop` (no `TAGALONG_FAKE_PROVIDERS`).
3. Open Settings from the tray, paste your **OpenRouter API key**, click Save, restart the app.

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

1. **Setup:** store a **Token Factory API key** as well (Settings, Save, restart). Then set:
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
   "Always answer in British English." to **Persona**. Save.
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
