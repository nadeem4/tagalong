# Tagalong

Tagalong is a desktop screen companion: a crew of AI pets that tag along on your screen. Press a key
and the pet you are talking to reads what you selected, looks at your screen, or reads the page you
are on in Chrome, then answers in a panel beside it. Pets remember what you tell them, hand work to
each other, and can watch the screen for you. They never take over your mouse or keyboard.

- [Using Tagalong](#using-tagalong): install it, set it up, and use it. Start here.
- [Developer guide](docs/development.md): build, test and package it from source.
- Canonical plan, task board and decisions: <https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc>
- Design: [docs/specs/2026-09-11-tagalong-design.md](docs/specs/2026-09-11-tagalong-design.md) ·
  Architecture: [docs/architecture.md](docs/architecture.md) · Test guide:
  [docs/testing/feature-test-guide.md](docs/testing/feature-test-guide.md)

## What is in this build

| In this build                                                                                       | Not in this build                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Windows desktop app with a setup wizard and an NSIS installer                                       | macOS and Linux (the installer configs exist but are unverified)    |
| Three providers: OpenRouter (Claude), Nebius Token Factory (NVIDIA Nemotron), Anthropic             | Voice: push to talk and spoken answers                              |
| Sight: selection, screenshot, every display, every open window, window text, capture exclusions     | Hands: MCP tools and approval cards                                 |
| Vision routing: a text-only Nemotron pet reads pictures with Nemotron Nano 2 VL                     | A cost dashboard                                                    |
| The crew: Scout, Ink and Bolt, handoff with `@Name`, pets consulting each other, `/crew` roundtable | Data export and delete-all in Settings                              |
| Memory across restarts, rolling screen memory (opt-in), watches ("tell me when this finishes")      | Code signing (the installer is unsigned) and an app icon of its own |
| The Chrome extension: the same crew in Chrome's side panel, reading the page you are on             |                                                                     |

# Using Tagalong

## Install

**Windows installer.** Run `Tagalong-Setup-<version>-x64.exe`. It installs for your user only, so it
needs no administrator rights, and it starts Tagalong when it finishes. The installer is not code
signed yet, so Windows SmartScreen may say "Windows protected your PC": click **More info**, then
**Run anyway**. Uninstalling from **Settings → Apps** keeps your settings and conversations in
`%APPDATA%\Tagalong`; delete that folder too to remove everything.

To build the installer yourself, on Windows with Node.js 22 and pnpm 10:

```powershell
pnpm install
pnpm package:win     # writes apps\desktop\release\Tagalong-Setup-0.0.0-x64.exe
```

**From source.** With Node.js 22 and pnpm 10 (see [How to run](docs/development.md#how-to-run) for getting pnpm):

```powershell
pnpm install
pnpm dev:desktop
```

Tagalong lives in the system tray. Its pets sit on the desktop as a small strip of avatars you can
drag anywhere.

## First run: the setup wizard

The first time Tagalong starts, a setup wizard walks you through everything, one step at a time.
Every step can be skipped with **Skip setup**, and you can run the wizard again from the tray menu
(**Setup wizard**) or from **Settings → Run the setup wizard again**.

1. **Welcome.** What Tagalong does and the privacy promise (also below, in [Privacy](#privacy)).
2. **Choose a provider.** Pick OpenRouter, Nebius Token Factory or Anthropic, click **Get an API key** to
   open that provider's key page in your browser, and paste the key. You can paste keys for more than
   one; the crew can mix providers. Keys go straight into the operating system's keychain.
3. **Meet your crew.** Scout is a Generalist, Ink a Writer, Bolt a Backend engineer. Pick a provider
   for each one; the model starts on the one its role recommends there (marked **Recommended**), and
   you can change it. The model box lists the provider's live models as soon as the key is stored.
4. **Hotkeys.** The four keys to remember, and the crew commands.
5. **Rolling memory (optional).** Let Tagalong remember the last few minutes of the screen, in memory
   only.
6. **Chrome extension (optional).** Where the extension is and the pairing token to paste into it.
7. **Done.** Press **Ask Scout something** to open the panel and ask your first question.

A key saved in the wizard or in Settings works on the very next question. No restart is needed.

## Providers and keys

Each pet runs on one provider and one model, and each provider needs its own API key. Keys are
entered in the wizard or in Settings, encrypted with the OS keychain, and only ever sent to the
provider they belong to.

| Setup                               | Where to get the key                                                                                                       | Model ids                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenRouter + Claude**             | [openrouter.ai/keys](https://openrouter.ai/keys)                                                                           | OpenRouter's catalog at [openrouter.ai/models](https://openrouter.ai/models), for example `anthropic/claude-sonnet-5` or `anthropic/claude-haiku-4.5`. The wizard and Settings list them live.                                                                                                                                |
| **Nebius Token Factory + Nemotron** | [tokenfactory.nebius.com](https://tokenfactory.nebius.com/), under API keys                                                | Token Factory's model list (`GET https://api.tokenfactory.nebius.com/v1/models`, shown live once the key is stored): `nvidia/nemotron-3-super-120b-a12b` (Nemotron 3 Super, text), `nvidia/Nemotron-Nano-V2-12b` (Nemotron Nano 2 VL, sees pictures), `nvidia/nemotron-3-nano-30b-a3b` (Nemotron 3 Nano, cheap watch checks). |
| **Anthropic**                       | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) (an API key, not a Claude subscription) | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`.                                                                                                                                                                                                                                                                       |

The two Nemotron ids marked as seeing and watching above could not be checked against the live list
when they were written. If a pet answers "model not found", open Settings and pick the id from the
live list next to the model box: it is the authority.

**Pictures on a text-only model.** Nemotron 3 Super cannot see. A pet on it gets a **vision model**
(Nemotron Nano 2 VL by default), and any turn that carries a screenshot goes there instead. Claude sees
on its own and needs no vision model.

Any other OpenAI-compatible service also works: in Settings, put its base URL in one of the base URL
boxes, store its key there, and type its model id on the pet.

## Hotkeys

| Key                | What it does                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `Ctrl+Shift+Space` | **Ask.** Opens the panel with the text you have selected and the active window's name |
| `Ctrl+Shift+S`     | **Look.** The same, plus a screenshot of the active window                            |
| `Ctrl+Shift+Alt+S` | **See everything.** Every screen, plus a list of every open window                    |
| `Ctrl+Shift+Alt+P` | **Pause sight.** Nothing is read until you press it again (also in the tray)          |
| `Alt+Shift+Space`  | In Chrome, with the extension: opens the side panel with your selection               |

Escape or clicking elsewhere hides the panel. Every key can be changed in Settings, and the change
works at once. The bigger the look, the more it costs: a screenshot adds roughly 1,500 input tokens.

## Pets and the crew

A fresh install has three pets. Click one on the strip to talk to it.

| Pet      | Good at                               |
| -------- | ------------------------------------- |
| 🔎 Scout | Explaining what is on your screen     |
| ✒️ Ink   | Writing and rewriting in your voice   |
| ⚡ Bolt  | Reading errors, stack traces and code |

- **Hand off.** Start a message with `@Ink` (or any pet's name) and that pet takes over, with a
  summary of the conversation so far. **Hand off…** under an answer does the same.
- **Ask another pet.** A pet may consult another one mid-answer when it knows better; a small card in
  the panel says who it asked.
- **The roundtable.** Start a message with `/crew` (or press **Crew**) and every pet answers in turn,
  seeing the others' answers, and the pet you asked closes with a summary. Pets on different
  providers and models think differently, which is the point. A roundtable of three costs four model
  calls; the panel footer counts them.
- **Memory.** Tell a pet "I prefer short answers" and it remembers across restarts.

### Home: see and control your agents

Right-click the tray icon and choose **Open Home**. Home is where the whole crew lives:

- **The agent list** on the left shows every agent, its role and whether it is working or at its desk.
- **The scene** in the middle shows them at work. Its look is a theme; the first theme is the
  **Office** (desks, glass meeting rooms, a lounge). Themes only change the picture, never where the
  controls are.
- **Activity** on the right lists what the crew did, newest first: every answer (with the model and
  how many model calls it took), every question one agent asked another, every handoff and every
  roundtable. Click one to read it.
- **Add agent** under the list creates a new Generalist and opens its controls.
- **Pick an agent** in the list to change it: its role (Generalist, Backend engineer, Frontend
  engineer, Writer, Researcher or Companion, which hands work to your experts instead of doing it), its provider and model (**Recommended** for its role, or your own
  choice), its tools, its private notes, its look, and whether it is the pet on your desktop. The card
  beside it shows how its teammates see it. **Save** applies from the next question.
- **Meetings** will appear in their own tab once agents can meet.

Settings keeps the app-wide things: keys, hotkeys, summaries, sight, awareness and the browser
extension.

Upgrading from a version before roles? Tagalong opens Home once with a short notice saying which role
each pet got and whether your own persona was kept as notes. **Got it** closes it for good; **Review
my crew** opens the first agent's controls.

## The Chrome extension

The extension puts the same crew in Chrome's side panel and lets a pet read the exact page you are
on. It needs the desktop app running.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the extension folder. The installer ships it in
   `%LOCALAPPDATA%\Programs\Tagalong\resources\extension` (the wizard's **Show folder** button opens
   it). From source, build it with `pnpm --filter @tagalong/extension build` and choose
   `apps/extension/dist`.
3. Copy the pairing token from the wizard or from **Settings → Browser extension**, paste it into the
   extension's options page, and click **Save and connect**.

Then click the toolbar button, or select text and press `Alt+Shift+Space`. More in
[The Chrome extension](docs/development.md#the-chrome-extension-in-detail).

## Watch mode and rolling memory

- **Watches.** Ask "tell me when this finishes" and the pet watches the screen for you. Tagalong
  compares the screen on your machine every five seconds and only asks a small, cheap model (Nemotron 3
  Nano on Token Factory, Claude Haiku elsewhere) once something changed and settled. When it happens
  you get a notification and a card in the panel. A **Watching** chip shows the checks spent and has
  **Stop**.
- **Rolling memory** (off by default; turn it on in the wizard or **Settings → Awareness**). Tagalong
  keeps a small picture of each screen every five seconds, in memory only, for the last ten minutes,
  so you can ask "what was I reading five minutes ago?". A red dot on the pets shows while it
  records.

## Privacy

- Nothing is read until you press a hotkey or ask, except rolling memory and watches, which you turn
  on. Every look badges the pets and the tray says what was read and when.
- Password managers, the Windows security prompt and the lock screen are never captured. The list is
  editable.
- Screenshots are not written to disk. Rolling memory and watches live in memory only and are thrown
  away when you pause sight or quit.
- What you ask goes only to the provider your pet runs on. There is no Tagalong server.
- API keys are encrypted with the OS keychain.
- `Ctrl+Shift+Alt+P` pauses all sight at once.

The full detail is in [Privacy in detail](docs/privacy.md).

## Troubleshooting

| Problem                                                        | What to do                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pet says "No … API key is stored"                            | Paste that provider's key in the wizard or Settings. It works on the next question.                                                                |
| A pet says the model was not found, or the provider refused it | Open Settings and pick the model from the live list next to the pet's model box.                                                                   |
| The pet ignores the screenshot, or warns it cannot see         | Its model is text-only. Give it a vision model in Settings (Nemotron Nano 2 VL on Token Factory) or move it to Claude.                             |
| A hotkey does nothing                                          | Settings and the panel name any key another app already owns; pick another. Check that sight is not paused (tray → **Pause sight**).               |
| The Chrome side panel says "Disconnected"                      | The desktop app must be running. If it is, copy the pairing token again from Settings and paste it into the extension's options.                   |
| "Windows protected your PC" when installing                    | The installer is unsigned. Click **More info**, then **Run anyway**.                                                                               |
| You want the wizard again                                      | Tray → **Setup wizard**, or Settings → **Run the setup wizard again**.                                                                             |
| You want to start over                                         | Quit Tagalong and delete `%APPDATA%\Tagalong`. That removes settings, conversations, memories and stored keys; the wizard opens on the next start. |
| From source, a look always captures the whole screen           | The active-window helper was not downloaded: run `node apps/desktop/scripts/fetch-native.mjs`. The installer already includes it.                  |
| It does not start on macOS or Linux                            | Not in this build: only Windows has a platform adapter so far.                                                                                     |

## No computer control

Tagalong never moves your mouse or types for you. Pets do not click, type, or drive other
applications. When pets gain tools (a later phase), every action will go through tools you connect
and approve, and every action will be logged.

# For developers

- [Developer guide](docs/development.md): build, run, test and package from source.
- [Architecture](docs/architecture.md): how the engine and its hosts fit together today.
- [Concepts](docs/concepts/): how pets remember, meet and talk to each other.
- [Privacy in detail](docs/privacy.md): exactly what is read, when, and what never is.
