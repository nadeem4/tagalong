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

1. **Setup:** at least two pets (add one in the desktop Settings if needed); side panel open.
2. **Action:** pick the second pet in **Pet** and ask "Who are you?".
3. **Expected:** the answer comes in the second pet's persona; the conversation area starts empty for
   that pet.
