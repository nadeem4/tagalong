# Tagalong

Tagalong is a desktop screen companion for Windows. One companion, Scout, sits on your screen.
Press a key and Scout sees what you are working on: the text you selected, the window you are in,
or the page you are on in Chrome. It writes a brief, hands the work to an expert (Claude Code
first), follows it and brings the answer back in a bubble beside it. Scout never moves your mouse
or types for you.

There are three ways in:

1. [Download and run it](#download-and-run-it): install the Windows app and use it.
2. [Run it from source](#run-it-from-source): clone the repo and start the desktop app.
3. [Build your own body](#build-your-own-body): talk to the Python brain over its local protocol.

The [user guide](#using-tagalong) follows.

## Download and run it

There is no public download page yet. Until releases are published, build the installer yourself
on Windows with Node.js 22 and pnpm 10:

```powershell
pnpm install
pnpm package:win     # writes bodies\desktop\release\Tagalong-Setup-<version>-x64.exe
```

Then run `Tagalong-Setup-<version>-x64.exe`.

- It installs for your user only, needs no administrator rights, and starts Tagalong when it
  finishes.
- The installer is not code signed yet. If Windows SmartScreen says "Windows protected your PC",
  click **More info**, then **Run anyway**.
- Your settings, conversations and stored keys live in `%APPDATA%\Tagalong`. Uninstalling from
  **Settings → Apps** keeps that folder; delete it too to remove everything.

Tagalong lives in the system tray, and Scout sits on your desktop. [First run](#first-run) says what to start.

## Run it from source

You need Windows 11, Node.js 22 or newer and pnpm 10.

The desktop talks to the Python brain and starts it for you when none is running (you need `uv`
and an Anthropic key in `~/.tagalong/.env`, see [docs/brain.md](docs/brain.md)). The brain
runs on Python 3.12 or 3.13; `uv` fetches one if you have neither.

```powershell
cd brain
uv sync
cd ..
pnpm install
pnpm dev:desktop    # starts the brain too, and stops it when you quit
```

To run the brain on its own instead (for example on another machine), use
`cd brain && uv run brain`; the desktop connects to it and leaves it running.

To let Scout hand work to Claude Code, install its adapter once with
`npm install -g @agentclientprotocol/claude-agent-acp` (Node 22 or newer). Claude Code must be
logged in: it runs on your own login, not the API key.

Scout remembers instructions and facts about you across restarts, in `~/.tagalong/tagalong.db`, and picks the conversation back up after a restart. Scout can also use the desktop's window tools.

If the brain is not running, the desktop still opens and shows "Scout's brain is not running." It
connects by itself once the brain is up.

When Scout's brain wants to use a tool that needs your say-so, the bubble asks in Scout's words
with **Allow once**, **Always allow** (not offered for a locked tool) and **Deny**. Several asks
queue and show one at a time; if the brain is offline when you click, the card stays up.

The brain keeps a history of every such ask and how it ended (approved, refused, timed out, or no
one was there), for Scout's tools, connected-app tools and Claude Code's permission asks. It also keeps plain-sentence
preferences, starting with "Always ask me before risky actions". After you have allowed the same
kind of ask three times in two weeks, Scout may offer to approve it from now on; only a "Yes" saves a
preference. With a preference of yours saved, Scout looks at each ask first and may approve it once
under that preference, then tells you which one. Anything unclear still comes to you. Home's
**Approvals** page shows all of it. See [docs/brain.md](docs/brain.md).

Scout can speak first. When a background job ends, the brain wakes Scout once (jobs that end within
30 seconds share one wake), and Scout decides whether it has anything to say. The wake limit is
`TAGALONG_WAKES_PER_HOUR` (default 12). Scout can also set its own timers (a reminder, or a
repeating check, no more often than every 5 minutes); they survive a brain restart. Scout also
notices when you come back after 5 minutes away or reopen the app after a long break, and knows
which app is in front (never one you excluded, and none while sight is paused); it may greet you or
stay silent, at most twice an hour per kind. When Claude Code asks a question during a job, Scout
gets it first and answers from what it knows, or passes it to you. See [docs/brain.md](docs/brain.md).

The [developer guide](docs/development.md) covers getting pnpm, testing, packaging and the browser
body.

## Build your own body

A body is anything that shows Scout and can read what you are looking at. The Python brain listens
on a local WebSocket and speaks contract v1, written down in [protocol/README.md](protocol/README.md),
with sample frames in `protocol/examples`. `@tagalong/contract` (`protocol/ts`) holds the zod schemas
and `BrainClient`, the client both shipped bodies use. It is **not published to npm**: depend on it
from this repo with `"workspace:*"`. Read [Architecture](docs/architecture.md) for how the brain and
its bodies fit together.

## What is in this build

| In this build                                                                                                                                                                                                                                                                                                 | Not in this build                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Windows desktop app with an NSIS installer                                                                                                                                                                                                                                                                    | macOS and Linux (the installer configs exist but are unverified)    |
| One companion, Scout, that hands work to experts (Claude Code) and brings the answer back                                                                                                                                                                                                                     |                                                                     |
| Scout talks: answers read aloud in a calm British voice, made by your own brain                                                                                                                                                                                                                               |                                                                     |
| Talk to Scout: hold a key, ask out loud, hear a short spoken answer; speech is turned into text by your own brain, and audio is never stored                                                                                                                                                                  |                                                                     |
| Scout thinks with your Anthropic key, set in the brain's `.env`                                                                                                                                                                                                                                               | An "always allow" for changes in connected apps                     |
| Connections: Scout uses your apps over MCP (local commands or web addresses, added in Home); every change asks first                                                                                                                                                                                          |                                                                     |
| Timers: Scout sets its own reminders and repeating checks, and speaks first when a job ends or you come back                                                                                                                                                                                                  |                                                                     |
| Spend: Home shows what Scout spent today against a daily limit (`TAGALONG_DAILY_BUDGET_USD`, default 5); at the limit Scout pauses for the day                                                                                                                                                                |                                                                     |
| Sight: selection, a screenshot of one window, every open window, window text, built-in blind spots                                                                                                                                                                                                            |                                                                     |
|                                                                                                                                                                                                                                                                                                               | Data export and delete-all in Settings                              |
| Memory across restarts                                                                                                                                                                                                                                                                                        | Code signing (the installer is unsigned) and an app icon of its own |
| The browser body: Scout lists and reads your open tabs, pictures the front one, reads its links, tables and forms, searches history, bookmarks and downloads, acts on tabs, and takes questions from a right-click or the address bar, in Chrome, Edge and other Chromium browsers, after you allow each step |                                                                     |

# Using Tagalong

## First run

There is no setup window. Start Tagalong (it starts the brain if none is running); Scout appears on your screen. The brain's model and key are in its `.env`; hotkeys, listening and the rest are under **Home → Settings**.

## Asking Scout

Press Ctrl+Shift+Space (or click Scout) to open Scout's bubble. A click opens it at once without
looking; the key also brings what you are on. Drag Scout anywhere on your screen and the bubble
follows. Escape or the × closes it.

The bubble shows what Scout can see as chips (the app and window, selected text).
Remove any chip you do not want sent, type the question and press Enter. The answer appears in the
bubble, the next question continues the same conversation, and **Open full chat** shows the whole
conversation in a taller window (**Back to bubble** returns).

There is no key for a screenshot or for your other windows. Scout lists what is open (minimized
windows too), reads the window that matters, or takes a screenshot itself, only when a question
needs it. It can photograph a window sitting behind others, though not a minimized one, and it
looks past its own bubble to the window you were using. A screenshot adds roughly 1,500 input
tokens, which is why it is not taken on every question.

**Hand-offs.** Scout can hand a task to Claude Code, which works in a folder on this computer as a
job. Watch it in **Home → Jobs**: **Stop** a running one, **Show result** for a finished one. When
Claude Code asks for permission or has a question, Scout gets it first and answers from what it
knows, or passes it to you. Ask Scout to tell a working job something ("tell Claude to use dayjs, not
moment") and it passes the note on.

**Scout talks.** Scout reads its answers aloud, so you can look away: the answer, a
line it says on its own and its line about an expert that finished. Scout
decides what to say: everything it writes is spoken, typed question or spoken, except what it
puts in a block (code, a long list), which is shown in the bubble and not read. Bars beside the × show while it speaks;
click them, close the bubble or press `Ctrl+Shift+Alt+M` to stop it at once. The voice is
Kokoro, made on this computer: the first time Scout speaks it downloads the voice model (about
92 MB) and uses the Windows voice until that is done. Turn it off, pick a voice, preview it or
change the speed in **Home → Settings → Voice**.

**Talk to Scout.** Hold `Right Ctrl` on its own (or click the mic in the bubble), say
your question and let go (or click again). Press another key while holding it (Right Ctrl+C, say)
and nothing is sent: you meant a shortcut. The bubble shows your words as you talk, then what it
heard, and Scout answers out loud
the way a person talks: short sentences, one question back at most, details left in the bubble.
It starts speaking on the first sentence rather than waiting for the whole answer. Talking while
Scout speaks cuts it off. When it is done the bubble says "Hold Right Ctrl to reply".
The microphone opens on that key or the mic button, or all the time only if you switch Always
listening on in the bubble (then start with "Scout"; "Scout, stop" turns it off; it pauses while a
call or a full-screen window is in front, and while the pets are hidden). Your speech is turned into text by your own brain, and audio is never stored, by
small models (Silero VAD, Moonshine and Smart Turn) downloaded the first time (about 43 MB); the
audio is never sent or kept.

**Read it to me.** Type or say "read this to me" and Scout reads your selection, or the window in
front, aloud in full: the text itself, lists as sentences, code described rather than spelled out.
Ask "summarise this" and it speaks a summary; for something long it gives the gist first. The stop key, ×
and the bars cut it off. Ask "what's in this chart?" (or about a photo, diagram or screenshot) and
Scout gives the kind, the axes, the trend and the values that stand out, and says when it can't
make one out.

**Memory.** Tell Scout "I prefer short answers" and it remembers across restarts. See and delete
what it remembers in Home, or say "Scout, forget that".

**"Scout, what's wrong?"** Ask that (or "are you OK?", or "health check"), typed or spoken, and the
bubble shows a health card: your connections, its voice and your
microphone, each with a plain line, starting "Two things need you." or
"Everything's working." (shown, never said aloud). **Fix it** on a row opens the place that fixes it. It calls no model and
reads no screen, so it works even when Scout cannot think.

## Hotkeys

| Key                        | What it does                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `Ctrl+Shift+Space`         | **Ask.** Opens the bubble with the text you have selected and the active window's name |
| `Ctrl+Shift+Alt+P`         | **Pause sight.** Nothing is read until you press it again (also in the tray)           |
| `Ctrl+Shift+Alt+M`         | **Stop speaking.** Scout stops talking at once and drops what it was about to say      |
| `Right Ctrl` (hold, alone) | **Talk to Scout.** Listens while held; let go and Scout answers out loud               |

Every key can be changed in **Home → Settings → Shortcuts** (the talk key, one key held alone, under **Voice**), and the
change works at once.

## Home: one window for everything

Right-click the tray icon and choose **Open Tagalong**. The tray has only four items: **Open
Tagalong**, **Pause sight**, **Show or hide Scout** and **Quit**. Home holds the rest, in six pages:

- **Overview**: whether Scout is ready and what it thinks with, what was spent today, and where things run (the brain's address and whether it is connected, each connected app's command or web address, Claude Code).
  **Spend** shows the dollars spent today against the daily limit,
  as the brain reports them. The brain's limit is $5 a day unless `TAGALONG_DAILY_BUDGET_USD` sets
  another when the brain starts. A single
  Scout turn is also stopped after 300 seconds unless `TAGALONG_TURN_TIMEOUT_S` sets another;
  Scout then says it took too long. Time spent in tools, or waiting for you to answer, does not count.
- **Jobs**: the jobs Scout has handed to Claude Code, with **Stop** for a running one and **Show
  result** for a finished one. Claude Code must be installed and signed in on this computer.
- **Connections**: the apps Scout can use, so "what is on my calendar" or "any reviews waiting on
  GitHub" just work. The Python brain runs these itself (stdio or http MCP apps, a pasted key for
  http) and this page reads and changes them through the brain, so the brain has to be running.
  Apps with their own sign-in page work too (see [docs/connected-apps.md](docs/connected-apps.md)).
  - **Sign in**: an app that signs in with its own page shows **Needs sign-in** and a **Sign in**
    button. It opens the app's page in your browser; the chip reads **Waiting for the browser**
    until you finish (or five minutes pass). The brain and the browser must be on the same computer.
  - **Add an app**: any MCP server, by its https address (with a pasted key, the app's own sign-in
    page, or none) or by the
    command that starts it on this PC (with `NAME=value` lines for its environment; `${NAME}` takes
    the value from your own environment). A pasted key goes to the brain once and is never shown
    again.
  - Each app shows its name, whether it runs on this PC or is a web address, whether it works (with
    a plain line when it does not), how many tools it has, an on/off switch, **Restart** and
    **Remove** (which asks once more).
  - Which of an app's tools ask first is set in Settings › Permissions.
  - Scout reads with an app on its own. Anything that changes something (a tool the app does not
    mark read-only) shows a card in Scout's bubble: which app, what will change, **Allow once** or
    **Cancel**.
- **Approvals**: the preferences Scout follows (the sentence, when you agreed to it, how often it was used, with **Edit** and **Remove**; "Always ask me before risky actions" is listed like any other), a summary of how many asks there were, how many Scout answered and how many you refused, and the history of every permission ask by day, filtered by **All**, **Decided by Scout** or **Refused**. A row Scout approved says so and quotes the preference it relied on. When Scout approves an ask, a small quiet card in the bubble says "Approved for you" and which preference it used.
- **What Scout remembers**: its facts, preferences and conversation summaries, newest first.
  Delete any one.
- **Settings**, in six sections. Press ⓘ beside a setting for the longer story. Below the form,
  **Permissions** lists each tool Scout can use with an **Ask** or **Auto** switch: Auto means Scout
  does it without asking. A tool its body marks as always confirm is fixed on Ask,
  and a tool of a body that is not connected is dimmed. Claude Code's tool shows **Asks itself**
  instead of a switch, because Claude Code does its own asking.
  - **Privacy**: what Scout never looks at.
  - **Voice**: **Scout talks** (on by default), the voice (George or Fable) with **▶ Preview**, the
    speed, the **Talk to Scout** key and the microphone it listens on.
  - **Shortcuts**: the ask, pause and stop-speaking keys.
  - **Add Scout to your browser (optional)**: the folder to load unpacked in Chrome or Edge.

## Providers and keys

Scout thinks through the Python brain. It needs `ANTHROPIC_API_KEY` in its environment or in `<TAGALONG_HOME>/.env` (see
`.env.example`). Experts run on your Claude Code sign-in instead. Keys never pass through the
desktop.

## The browser body

The browser body lets Scout list your open tabs, read one, take a picture of the tab in front, pull
out its links, tables, headings or the shape of its forms, and search your history, bookmarks,
reading list, downloads and recently closed tabs. It also tells Scout which tab you are on and which
download just finished, without waking it. Scout can also open, close, switch, group, bookmark and
save tabs when you ask, and you can ask Scout from a right-click on selected text or by typing
`scout` and a question in the address bar; the answer appears in the desktop bubble. It is a second
body for the Python brain, so a brain must be running (`pnpm dev:desktop` starts one, or run `cd brain && uv run brain`).

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the folder shown in **Home → Settings → Add Scout to your
   browser**. The installer ships it in `%LOCALAPPDATA%\Programs\Tagalong\resources\extension`.
   From source, build it with `pnpm --filter @tagalong/browser build` and choose
   `bodies/browser/dist`.
3. Nothing to paste: it dials `127.0.0.1:47321`. Click the toolbar button to see the link, change
   the brain's address or name the browser.

Ask Scout about your tabs. The first time it needs something (your tabs, a site, your history and
so on), a small window asks you. More in
[The browser body](docs/browser-body.md).

## Drop it on Scout

Drag a file, an image, a link or selected text onto Scout and it asks whether
to explain it or hand it to an expert. Nothing is read until you press a button, and secrets files
such as `.env` are refused.

## Privacy

- Nothing on screen is read until you press a hotkey or ask, except the title of your front window, which the desktop sends to the brain. Every look badges Scout and the tray says what
  was read and when.
- **Scout's face** dozes after five minutes with no input or when the screen locks (one idle time
  number from the OS, kept on this computer).
- Scout never looks at its built-in blind spots: password managers, the Windows sign-in and security
  prompts, secret files such as `.env` and SSH keys, private browsing, authenticator apps and Remote
  Desktop. They are always on and listed in Settings; you can add your own.
- Any key, token, password or card number in what is sent is replaced with `[hidden: ...]` before it
  leaves your computer.
- Screenshots are not written to disk.
- **Home → What Scout remembers** lists what Scout keeps about you until you delete it; delete any
  one there, or ask Scout to forget it.
- What you ask goes only to the provider Scout runs on. There is no Tagalong server.
- Scout's voice is made on your computer; the words it speaks are never sent anywhere.
- When you talk to Scout, your speech is turned into text on your computer. The audio never leaves
  it and is never stored; only the text goes to Scout's provider, like a typed question.
- The Python brain reads its provider key (`ANTHROPIC_API_KEY`) from the environment or the `.env` file in its data folder; it is never saved to the database or logs.
- `Ctrl+Shift+Alt+P` pauses all sight at once.
- Tagalong never moves your mouse or types for you. Scout does not click, type or drive other
  applications. It changes things only through apps you connect, and only after you press
  **Allow once**.
- Connected apps get only what Scout fills in for one tool, with keys and passwords hidden. The
  Python brain keeps an app's secrets in its own files (`app-tokens.json` and `app-oauth/`), not in
  the apps table, deletes them on **Disconnect**, and saves chat, approvals, job results and
  progress and logs with keys and tokens shown as `[secret]` (Scout's live turn is not masked).

The full detail is in [Privacy in detail](docs/privacy.md).

## Troubleshooting

| Problem                                                  | What to do                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scout shows **Signed out**, **No brain** or **No key**   | Click Scout: the bubble's row says why it can't think. **Fix it** opens the right place in Settings.                                                    |
| Scout says it has no API key                             | Put `ANTHROPIC_API_KEY` in the brain's `.env` file and restart the brain.                                                                               |
| Scout ignores the screenshot, or warns it cannot see     | Its model is text-only. Use a Claude model in the brain's setup.                                                                                        |
| A hotkey does nothing                                    | Settings and the bubble name any key another app already owns; pick another. Check that sight is not paused (tray → **Pause sight**).                   |
| Scout is silent                                          | Check **Scout talks** in Home → Settings → Voice, and your sound output. The stop key only silences the current answer.                                 |
| Talk to Scout says it could not open the microphone      | Windows Settings → Privacy → Microphone: let desktop apps use it. Pick the right microphone in Home → Settings → Voice.                                 |
| Scout shows **Mic busy**, **No mic** or **Can't listen** | Click Scout: the bubble's row says why, and **Fix it** opens Voice settings. Close the app holding the microphone; Can't listen retries itself.         |
| With Always listening on, Scout doesn't react            | Say "Scout" first ("Scout, what is this?"). The dot pulses when it hears you. Right after Scout answers aloud, a reply needs no name for 20 s.          |
| The first spoken question takes a while                  | The first time, Tagalong downloads its speech models (about 43 MB). After that they are read from disk.                                                 |
| Scout's voice changes after the first answers            | The first time it speaks, Scout downloads its voice (about 92 MB) and uses the Windows voice until then. Offline, it keeps the Windows voice.           |
| The browser popup says Scout's brain is not reachable    | Start a brain (`pnpm dev:desktop` does, or `cd brain && uv run brain`). If it runs elsewhere, set its address in the popup. The body retries by itself. |
| "Windows protected your PC" when installing              | The installer is unsigned. Click **More info**, then **Run anyway**.                                                                                    |
| Sending logs with a problem report                       | Ask Scout "what's wrong?", press **Open logs folder** (`%APPDATA%\Tagalong\logs`). Warnings and errors only, never speech or screen text.               |
| You want to start over                                   | Quit Tagalong and delete `%APPDATA%\Tagalong`. That removes settings, conversations, memories and stored keys.                                          |
| From source, Scout never knows which window you are on   | The active-window helper was not downloaded: run `node bodies/desktop/scripts/fetch-native.mjs`. The installer already includes it.                     |
| It does not start on macOS or Linux                      | Not in this build: only Windows has a platform adapter so far.                                                                                          |

# For developers

- [Engineering docs](docs/README.md): the index of every subsystem doc, with a reading order.
- [Developer guide](docs/development.md): build, run, test and package from source.
- [Architecture](docs/architecture.md): how the brain and its bodies fit together.
- [Feature test guide](docs/testing/feature-test-guide.md): manual tests for this build.
- [Product](PRODUCT.md) and [design system](DESIGN.md).
- [Privacy in detail](docs/privacy.md): exactly what is read, when, and what never is.
