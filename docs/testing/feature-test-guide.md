# Tagalong feature test guide

Step-by-step manual tests for what this build does, written so someone who did not build the
feature can run it and know whether it passed. Each step lists **Setup**, **Action** and
**Expected**. A step passes only if everything under Expected is true.

## Contents

- [Configuration](#configuration)
- [First run: Welcome](#first-run-welcome)
- [Scout's brain](#scouts-brain)
- [Hand-offs to Claude Code](#hand-offs-to-claude-code)
- [Settings](#settings)
- [Greeting](#greeting)
- [Keeping an eye on things](#keeping-an-eye-on-things)
- [Voice: Scout talks](#voice-scout-talks)
- [Talk to Scout](#talk-to-scout)
- [Connections: your apps over MCP](#connections-your-apps-over-mcp)
- [Routines](#routines)
- [Memory](#memory)
- [Screen memory](#screen-memory)
- [The Chrome extension](#the-chrome-extension)
- [Installer](#installer)
- [Not in this build](#not-in-this-build)

## Configuration

Every test runs on the Windows desktop app, either installed ([Installer](#installer)) or from
source with `pnpm dev:desktop` **without** `TAGALONG_FAKE_PROVIDERS`, unless a step says otherwise.
Home opens from the tray (**Open Tagalong**); Settings is a page in Home. A saved key or brain is
used from the next question, with no restart.

**The default for this guide: the Claude sign-in.** Install Claude Code, run `claude` once and sign
in (`claude auth status` says `"loggedIn": true`). On a fresh install Scout thinks with it on Haiku.

**OpenRouter + Claude.** Get a key at <https://openrouter.ai/keys>, paste it in Home → Settings →
Advanced → API keys → OpenRouter, then on Home's **Scout** page set **Thinks with** to OpenRouter
and **Model** to a Claude id (for example `anthropic/claude-sonnet-5`). Save.

**Nebius Token Factory + Nemotron.** Get a key at <https://tokenfactory.nebius.com/> (API keys),
store it the same way, and pick Token Factory on the Scout page. Its text models cannot see, and
Home sets no vision model, so screenshots are dropped with a warning (H5).

**Fake provider (no key).** Steps marked _fake provider_ need no key: launch from source with
`TAGALONG_FAKE_PROVIDERS=1` (PowerShell: `$env:TAGALONG_FAKE_PROVIDERS = '1'`). Scout streams a
scripted answer, hand-offs go to a scripted expert, and nothing leaves the machine. Keeping an eye
on things is off under it unless `TAGALONG_KEEP_AN_EYE=1` is also set.

**A fresh profile.** Run `pnpm --filter @tagalong/desktop start:fresh` (a new temp data folder each
time), or quit Tagalong and rename `%APPDATA%\Tagalong` (rename it back afterwards).

## First run: Welcome

### W.1. Welcome opens on a fresh install

1. **Setup:** a fresh profile.
2. **Action:** start Tagalong.
3. **Expected:** one window opens with Scout's pixel figure and **Hi, I'm Scout.**, then four parts:
   **Found on this computer** (Claude Code, Gemini CLI and Codex, each Ready, "Found. Hand-offs to it
   come soon." or Not installed with **How to add**), **How I think**, **What should I call you?**
   (optional) and **One key to remember** (`Ctrl Shift Space`). Scout itself is not on screen yet.

### W.2. How I think

1. **Setup:** W.1, Claude Code installed and signed in.
2. **Action:** read the choices under **How I think**.
3. **Expected:** **Claude Code sign-in** first, picked, "No key needed"; then one row per keyed
   service (OpenRouter, Token Factory, Anthropic), each "Paste a key below" or "Key stored".
4. **Action:** pick OpenRouter. **Expected:** a key box appears and **Start** stays disabled until
   something is typed in it.
5. **Without Claude Code** (not on PATH): the sign-in row is missing and a keyed service is picked.

### W.3. Start, the intro and the first expert

1. **Setup:** W.1, Claude Code sign-in picked, `Nadeem` typed in **What should I call you?**.
2. **Action:** press **Start**.
3. **Expected:** Welcome closes, Scout docks on the desktop and its intro opens (see G.1), greeting
   you by name. In Home → Experts, Claude Code is listed (Welcome adds it when it is installed). Home
   → Scout shows **Claude Code** and **Haiku (quick, recommended)**.
4. **Action:** quit and start Tagalong again. **Expected:** Welcome does not open; one launch line
   appears instead (G.2).

### W.4. Welcome again

1. **Action:** Home → Settings → Advanced → **Open Welcome again**.
2. **Expected:** Welcome opens again; **Start** finishes it as in W.3.

## Scout's brain

### H1. A key and the live model list

1. **Setup:** an OpenRouter key.
2. **Action:** Home → Settings → Advanced → API keys → OpenRouter → **Add key**, paste, Save. Open
   Home's **Scout** page and pick OpenRouter.
3. **Expected:** the key row says **Key stored**. The **Model** list holds OpenRouter's live models
   (hundreds of ids), not a handful of built-in ones.

### H2. Text

1. **Setup:** Scout on the default configuration.
2. **Action:** press `Ctrl+Shift+Space` and ask a question.
3. **Expected:** the answer streams into the bubble and ends with no error.

### H3. Look

1. **Setup:** as H2.
2. **Action:** click Scout and ask "what is on my screen?".
3. **Expected:** Scout looks (a capture shows on Scout and in the tray tooltip) and describes the
   screen, with **no** "cannot see images" warning.

### H4. What do you see?

1. **Setup:** windows on two screens, one minimized.
2. **Action:** ask "What do you see?".
3. **Expected:** a short answer per screen, numbered as Windows numbers them, then what is
   minimized, for example "Screen 1: VS Code on engine.ts, Chrome behind it. Screen 2: Slack.
   Minimized: Outlook." No screenshot is taken.
4. **Action:** ask "can you read the task in Chrome?".
5. **Expected:** Scout reads that one window's text and answers from it.

### H5. Token Factory + Nemotron

_Not the default configuration._

1. **Setup:** a Token Factory key stored; Scout on Token Factory with
   `nvidia/nemotron-3-super-120b-a12b`.
2. **Action:** (a) `Ctrl+Shift+Space` with a question; (b) "what is on my screen?".
3. **Expected:** (a) answered by Nemotron 3 Super; (b) Scout says it cannot see images and answers
   from the window list and text. Nothing breaks.

### H6. Edge cases

1. **Setup:** Home → Settings → Advanced → API keys.
2. **Action:** (a) type `openrouter.ai` in OpenRouter's base URL box and Save; (b) blank it and Save;
   (c) **Remove key** on OpenRouter with Scout on it, then ask.
3. **Expected:** (a) refused with a message naming the service; (b) back to the default; (c) the
   answer is the error "No OpenRouter API key is stored. Add one in Settings." and the app keeps
   running.

## Hand-offs to Claude Code

### E.1. Scout briefs, you press Send

1. **Setup:** Claude Code installed; it is listed and **On** in Home → Experts. A code file open in
   an editor whose title names a project folder.
2. **Action:** ask Scout "can you find why this test fails and fix it?".
3. **Expected:** a hand-off card in the bubble: **Agent** Claude Code, **Project** (guessed from the
   window, or **Choose the project to work in**), **Access** (**Reads only** until you press
   **Allow edits**), and the **Brief**, which you can edit. Nothing runs until **Send**.
4. **Action:** press **Cancel**. **Expected:** nothing runs.
5. **Action:** ask again and press **Send**. **Expected:** the card shows Claude Code's steps; when
   it finishes, Scout says "Claude Code has finished." and the answer shows in the bubble. Home →
   Activity lists the hand-off with its thread.

_Fake provider:_ the same flow runs with a scripted expert that "read the brief and has nothing to
change".

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
4. **Action:** type the ask key's combination into **Stop Scout speaking** (or **Talk to Scout**)
   and Save.
5. **Expected:** nothing is saved; the message reads "Stop Scout speaking uses the same keys as Ask
   Scout. Pick a different combination." and that field has the focus.

### S.6b. Home's overview says what is wrong, and Home fits a small screen

1. **Action:** sign out of Claude Code (`claude /logout`) with Scout on the Claude sign-in, and
   open Home → Overview. Sign in again and reopen Home. Then pause sight from the tray.
2. **Expected:** the Scout card reads "Signed out of Claude Code" with an amber dot, then "Ready"
   with a green one, then "Ready, sight paused". A Scout on a service with no key reads "No API key".
3. **Action:** make Home as narrow as it goes.
4. **Expected:** it stops at 880 px; the nav and every page stay usable, the overview cards two
   across, nothing cut off.
5. **Action:** press **Edit** on Scout's routine card, change its name in Home → Routines, look at
   Experts, then come back to Routines; Save; leave Routines and come back again.
6. **Expected:** the changed name is still in the form after the detour; after Save the list shows
   and the card's form does not reopen. With Home closed, **Edit** opens Home on Routines with the
   card in the form.

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

### S.9. A broken settings file does not stop the app

1. **Setup:** quit Tagalong. In `%APPDATA%\Tagalong`, replace the contents of `settings.json` with
   `{ not json`.
2. **Action:** start Tagalong, change any setting and save.
3. **Expected:** the app starts with the settings from `settings.json.bak` (or the defaults on a
   first save), and after the save the broken text is in `settings.json.corrupt` and
   `settings.json` is valid again.

### S.10. Nothing spins forever after a crash

1. **Setup:** start a hand-off to Claude Code, then end Tagalong from Task Manager while it runs.
2. **Action:** start Tagalong and open Home → Activity.
3. **Expected:** the hand-off reads "Interrupted: Tagalong closed before this finished." and is not
   running. A routine that was running shows its last run as failed.

### S.11. Claude Code installed with npm

1. **Setup:** Claude Code installed with `npm install -g @anthropic-ai/claude-code` (so `claude` is
   `claude.cmd`).
2. **Action:** confirm a hand-off to Claude Code.
3. **Expected:** it runs. With `claude` not installed at all the hand-off ends with a plain error
   and the app keeps running. A hand-off still running after 30 minutes stops with "Claude Code
   took longer than 30 minutes, so it was stopped."

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
3. **Expected:** one short line appears beside Scout within about a second of Scout appearing (for
   example "Morning. I'm here when you need me."), with the Claude Code sign-in too; your typing is
   not interrupted. It fades after about seven seconds. Pointing at it keeps it;
   clicking it opens the bubble to ask; × closes it. With no brain set up, or one that fails, a
   handwritten line appears instead. Nothing is captured (no capture dot, nothing in Activity).
4. **After a hand-off:** finish a hand-off to Claude Code, quit, start again. The line mentions
   Claude Code.
5. **Time away:** leave Tagalong running for a day or more, quit it, and start it again a few
   minutes later. The line greets for the time of day; it does not say "Back after a day".

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

### K.4b. Paused sight is said plainly

1. **Action:** pause sight (`Ctrl+Shift+Alt+P`) and ask "look at my screen".
2. **Expected:** Scout says sight is paused, not that the screen was empty.

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
   item or code is read. In a spoken question (hold the talk key) ask for "three numbered steps,
   each two sentences long": no part of any step is read, not even its second sentence.

### V.3. Stopping

1. **Action:** while Scout speaks, press `Ctrl+Shift+Alt+M`; on the next answer click the bars; on the
   next press Escape.
2. **Expected:** speech stops at once each time, and nothing queued is spoken afterwards, not even
   the next line that was already being got ready.

### V.3a. No pause between lines

1. **Setup:** the Kokoro voice downloaded (V.1).
2. **Action:** ask a spoken question (hold the talk key) whose answer runs to several sentences.
3. **Expected:** each sentence follows the last without a pause of a second or more between them.

### V.3b. Kokoro from the first line

1. **Setup:** the Kokoro voice downloaded (V.1), and Scout talks on. Quit Tagalong.
2. **Action:** start Tagalong and, after a few seconds, ask Scout something.
3. **Expected:** the answer is spoken by Kokoro, not the system voice. On a fresh profile, starting
   Tagalong downloads nothing into `%APPDATA%\Tagalong\voice` until Scout first speaks.

### V.4. The hello, an expert finishing and a remark

1. **Action:** finish Welcome and step through the intro with **Next**; restart Tagalong; hand a
   task to Claude Code; cause a line from keeping an eye on things (K.1).
2. **Expected:** each intro beat is spoken as it appears; the line on a later launch is spoken;
   "Claude Code has finished." and the start of its answer are spoken; the K.1 line is spoken, and
   its × stops it.

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
   With the network cut while ElevenLabs is set, the local voice takes over within 15 seconds.

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
3. **Action:** ask a spoken question with a long answer and hold the talk key again while it is
   still streaming, then say nothing and let go.
4. **Expected:** Scout stops and says nothing more of the old answer; the bubble keeps what was
   shown so far and no Stop button remains.

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
3. **Action:** with the bubble open, pick another microphone and change your name in Settings;
   Save, then talk to Scout without restarting.
4. **Expected:** the new microphone is used and Scout uses the new name.

## Connections: your apps over MCP

These use real apps and a real provider, so they are yours to run. Scout must think with a provider
that calls tools (your Claude sign-in or OpenRouter + Claude).

### C1. Connect Notion

- [ ] Home → **Connections** → Popular → **Connect Notion**. Your browser opens Notion's sign-in;
      the page says **Finish signing in to Notion in your browser.**
- [ ] Approve in Notion. The browser shows "You are signed in"; Home lists Notion as **Connected**
      with its tools, each **Reads** or **Asks first**.
- [ ] Restart Tagalong. Notion connects again with no browser.
- [ ] Remove Notion, connect it again and press **Cancel** (or Deny) on Notion's page. Home says the
      sign-in did not work straight away, not after five minutes.

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
- [ ] Ask for a page with a long body (a few paragraphs). The card shows the whole body, scrolling
      inside the card, never cut off with "...".

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
5. **When a watch fires** can be saved, but Scout cannot start a watch in this build, so it is not
   testable here.

### R5. Missed runs and quiet times

A run counts as late only when it starts **more than five minutes** after its time
(`LATE_AFTER_MS`); the scheduler looks every 15 seconds.

1. Make a routine **Every day** at a time one minute ahead, then put the PC to sleep and wake it at
   least **seven minutes** after that time. On waking, it runs once (within about 15 seconds) and its
   line says "(ran late)". Woken sooner, it still runs once, without "(ran late)".
2. Quit Tagalong before a routine's time and start it more than five minutes after: it runs once,
   with "(ran late)". Quit and start again: it does not run again.
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

## Memory

### M.1. A stated preference survives a restart

1. **Setup:** the bubble open.
2. **Action:** say "I prefer short answers." Wait for the reply. Quit Tagalong from the tray and
   start it again. Ask "Explain how DNS works."
3. **Expected:** the DNS answer is noticeably short (a few sentences, no long lists).

### M.2. Long conversations are folded into a summary

1. **Setup:** a tool that opens SQLite (`sqlite3`, or DB Browser for SQLite).
2. **Action:** in one conversation, exchange at least **10** questions and answers (20 messages)
   about one topic. Wait ten seconds after the tenth answer. Open `%APPDATA%\Tagalong\tagalong.db` and
   run `SELECT kind, text FROM memories WHERE kind = 'summary';` and
   `SELECT COUNT(*) FROM messages WHERE summarized_at IS NOT NULL;`.
3. **Expected:** one `summary` row describing the topic, and **16** summarised messages. A
   follow-up that depends on the start of the conversation is still answered correctly.

### M.3. Choose a different summarizer

1. **Setup:** an OpenRouter key stored, Claude Code installed and signed in.
2. **Action:** Home → Settings → **Advanced** → **Summaries** → **Summarize with**.
3. **Expected:** the list starts with **Same as Scout (default)**, then a Claude sign-in group with
   Haiku and Sonnet (no Opus), then OpenRouter's live models. Services with no key are not listed.
   Pick one and Save; reopen Settings: the choice is still selected. Pick **Same as Scout** and Save
   to go back.

## Screen memory

Scout cannot recall from screen memory or start watches in this build (see
[Not in this build](#not-in-this-build)); these steps check only the recording itself.

### SM.1. The settings and their defaults

1. **Action:** Home → Settings → Privacy, then Advanced → **Screen memory and watches**.
2. **Expected:** **Remember the last few minutes of the screen** is **Off**. Under Advanced:
   **Minutes of screen to remember** 10, **Checks per watch** 60, **Watches at once** 3, **Watch
   gives up after (minutes)** 30.

### SM.2. Turning it on shows the red dot, without a restart

1. **Action:** switch **Remember the last few minutes of the screen** on, Save. Do not restart.
2. **Expected:** within a second a **small red dot** shows on Scout; its label says it is recording
   the screen. No new file appears in `%APPDATA%\Tagalong`.

### SM.3. Pause and quit throw it away

1. **Action:** press `Ctrl+Shift+Alt+P`. **Expected:** the red dot goes and a **Paused** mark shows.
   Press it again: the dot comes back.
2. **Action:** quit Tagalong and look in `%APPDATA%\Tagalong`. **Expected:** no frame or image file.
3. **Action:** switch it off and Save. **Expected:** the dot goes on save.

## The Chrome extension

**Before you start:** Chrome 116 or newer, the desktop app running, and a long article open in a
Chrome tab (for example a Wikipedia article), called _the article_ below. In Home → Settings →
Privacy, add the title pattern `*Bank*` to your exclusions (used in X.12; remove it afterwards).

### X.1. Build and load the unpacked extension

1. **Setup:** a checkout with dependencies installed (`pnpm install`).
2. **Action:** run `pnpm --filter @tagalong/extension build`. In Chrome open `chrome://extensions`,
   switch on **Developer mode**, click **Load unpacked**, choose `apps/extension/dist`. Pin Tagalong.
   (Installed app: load `%LOCALAPPDATA%\Programs\Tagalong\resources\extension` instead.)
3. **Expected:** `apps/extension/dist` holds `manifest.json`, `service-worker.js`, `sidepanel.html`,
   `options.html` and `page-reader.js`. The Tagalong card shows no errors, and a new tab opens with
   the options page ("Pair Tagalong with this browser"), whose connection line says "Not paired. …".

### X.2. Refuse a bad token

1. **Action:** type `hello` into **Pairing token** and click **Save and connect**.
2. **Expected:** "That is not a pairing token. Copy the 64-character token from Tagalong Settings."
   The connection line still says "Not paired".

### X.3. Pair

1. **Action:** in Home → Settings → **Browser extension (optional)**, click **Copy** (it changes to
   "Copied"). Paste into the options page and click **Save and connect**. Leave the port empty.
2. **Expected:** within two seconds the connection line reads "Connected to Tagalong <version>."

### X.4. The side panel shows Scout

1. **Setup:** paired; the article tab in front.
2. **Action:** click the Tagalong toolbar button.
3. **Expected:** the side panel opens. Its header says "Connected to Tagalong …"; questions go to
   Scout. The sight bar says "Seeing" and names `page "<article title>"`.

### X.5. Ask about the whole page with nothing selected

1. **Action:** in the side panel ask "Summarise this page in three bullet points."
2. **Expected:** the answer summarises **the article**, not a generic answer. No screenshot is
   involved, and the panel's look button reads **Read this page**.

### X.6. Exact selection with the extension shortcut

1. **Setup:** close the side panel. Select one sentence with punctuation or quotes on the article.
2. **Action:** press `Alt+Shift+Space`, then ask "Quote back exactly what I selected."
3. **Expected:** the side panel opens with the selection's character count and the page in the sight
   bar; the answer contains the sentence exactly.

### X.7. The shortcut is listed and rebindable

1. **Action:** open `chrome://extensions/shortcuts`.
2. **Expected:** "Open Tagalong with the selection attached" bound to `Alt+Shift+Space`.

### X.8. The desktop hotkey in Chrome gets the exact selection and the page

1. **Setup:** on the options page click **Allow reading any tab when I ask** and accept Chrome's
   prompt ("On."). Open a **new** tab with another article, select a sentence, leave Chrome in front.
2. **Action:** press `Ctrl+Shift+Space` and ask "What did I select, and what is this page about?".
3. **Expected:** the desktop bubble opens as usual; the answer quotes the selection exactly and
   describes the page.

### X.9. The desktop hotkey falls back when the extension cannot read the tab

1. **Setup:** click **Stop reading other tabs** ("Off."). Open a new tab, select a sentence; do
   **not** click the toolbar button there.
2. **Action:** press `Ctrl+Shift+Space` and ask "What did I select?".
3. **Expected:** the answer still quotes the selection (from the desktop's clipboard read), with no
   noticeable delay and no error.

### X.10. Quit the desktop app: the panel shows disconnected

1. **Setup:** the side panel open with a question and answer in it.
2. **Action:** quit the desktop app from the tray.
3. **Expected:** within a few seconds the header reads "Disconnected: could not reach the Tagalong
   app. Retrying in Ns. Is the Tagalong app running?". The conversation stays. Sending now shows
   "not connected to the Tagalong app …" instead of hanging.

### X.11. The panel recovers when the app returns

1. **Action:** start the desktop app again and wait.
2. **Expected:** within about 30 seconds (usually one or two) the header reads "Connected to
   Tagalong …" again, without reloading the panel.

### X.12. Exclusions apply to browser tabs

1. **Setup:** the `*Bank*` pattern; a tab whose title contains "Bank", a sentence selected; reading
   any tab **On**.
2. **Action:** press `Ctrl+Shift+Space` and ask "What did I select?".
3. **Expected:** capture is blocked for this window; the answer has neither the selection nor the
   page's text.
4. **Action:** open the side panel on that tab and ask "What does this page say?", then "What is the
   title of this tab?".
5. **Expected:** neither answer contains the page's text or its title, only the browser's name.

### X.13. Pages Chrome does not let extensions read

1. **Action:** switch to a `chrome://settings` tab and click **Read this page**.
2. **Expected:** the sight bar says "Capture did not work"; nothing from the previous page is
   attached to the next ask.

### X.14. A wrong token is rejected

1. **Action:** on the options page, replace the token with 64 `f` characters, **Save and connect**.
2. **Expected:** "The Tagalong app rejected the pairing token. Paste the current one." and the side
   panel header shows the same with a **Pair with the Tagalong app** button. Paste the real token to
   recover.

## Installer

### I.1. Build the Windows installer

1. **Setup:** Windows with Node.js 22 and pnpm 10; a clean checkout; `pnpm install`.
2. **Action:** `pnpm package:win` from the repository root.
3. **Expected:** it ends without errors and `apps\desktop\release\Tagalong-Setup-0.0.0-x64.exe`
   exists. In `apps\desktop\release\win-unpacked\resources` there are `app.asar`,
   `app.asar.unpacked` (holding `better-sqlite3`'s and `get-windows`' Windows binaries) and
   `extension`.

### I.2. Install on a fresh Windows machine

1. **Setup:** a Windows machine or Windows Sandbox that has never run Tagalong, with no Node.js.
2. **Action:** run the installer (SmartScreen: **More info → Run anyway**), keep the default folder,
   finish, and complete Welcome.
3. **Expected:** no administrator prompt. Tagalong installs to `%LOCALAPPDATA%\Programs\Tagalong`,
   adds Start menu and desktop shortcuts, starts when the installer finishes, opens Welcome, and a
   first answer arrives — all without a terminal.

### I.3. Native modules work in the installed app

1. **Action:** (a) ask Scout "remember that my favourite colour is teal", quit, start from the Start
   menu, ask "what is my favourite colour?". (b) Put Notepad beside a browser, click into Notepad,
   select some text and press `Ctrl+Shift+Space`, then ask "which app am I in?".
2. **Expected:** (a) "teal": SQLite (`better-sqlite3`) loaded. (b) The bubble names Notepad and
   shows the selection: the active-window binding (`get-windows`) and the selection helper (`libnut`)
   loaded.

### I.4. Uninstall keeps your data; reinstall picks it up

1. **Action:** quit Tagalong, uninstall it from Windows **Settings → Apps**, then install it again.
2. **Expected:** the uninstall removes the program folder and shortcuts but leaves
   `%APPDATA%\Tagalong`. After reinstalling, Welcome does not open, and keys and history are as
   before.

## Not in this build

Do not test these here.

- **Screen recall and watches for Scout.** `recall_screen`, `what_changed`, `watch_for` and
  `look_closer` are built in the engine, but the Companion role does not list them, so "what was I
  reading five minutes ago?" or "tell me when this finishes" does not work. A routine **When a watch
  fires** can be saved but has nothing to fire it.
- **A vision model for a text-only brain.** Home has no vision model field; Nemotron text models
  drop pictures with a warning.
- **Cloud speech to text and a microphone step in Welcome.** Speech is turned into text on this
  computer only.
- **"Always allow" for connected apps.** Every change asks.
- **macOS and Linux.** The app stops at launch on both; their installer configs are unverified.
- **Cost dashboard.** The side panel estimates image tokens, but there is no usage view.
