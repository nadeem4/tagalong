# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Rendered with web technology inside an Electron desktop app (Windows 11 today; macOS and Linux
later) and a Chrome extension side panel. Desktop conventions apply: tray, global hotkeys,
always-on-top windows, keyboard first.

## Users

Two audiences, served by the same product:

- **Technical people** who live at their computer: developers and engineers reading errors,
  reviewing code, fixing builds, writing docs. They are the first to install it and will use the
  depth (models, experts, settings).
- **Non-technical people**: anyone who reads, writes and researches at a computer and wants help
  without learning a tool.

The non-technical user sets the floor: every default, label and first-run step must make sense
without technical background. Technical depth is always available, one step further in, never in
the way.

## Product Purpose

Tagalong puts **Scout**, one AI companion, on your screen. Scout sees what you are working on,
answers, and when something needs real work it writes a brief and hands it to the right
**expert** (Claude Code first; other AI tools later), then brings the answer back. It removes the
copy, switch app, paste, ask, switch back loop. Scout never does the expert's work itself, and
never hands anything over without you pressing Send.

Success: people keep it running all day, ask it things they would otherwise not bother to ask, and
trust it with their screen.

## Positioning

Not a chat window you go to: a companion that sits with you. Scout keeps an eye on window titles,
reads or photographs a window only when it matters, speaks up rarely, and never takes over your
mouse or keyboard. Experts do the heavy lifting in the background; Home shows every hand-off and
its result.

## Operating Context

- Runs all day in the background: tray icon, Scout docked on the desktop, a bubble that opens
  beside it on a hotkey and hides on Escape.
- Hotkeys: `Ctrl+Shift+Space` ask (brings the selected text and the window you are on),
  `Ctrl+Shift+Alt+P` pause sight, `Ctrl+Shift+Alt+M` stop speaking, `Ctrl+Shift+Alt+Space` held
  to talk to Scout.
- "What do you see?" is answered per screen from the window list, without a screenshot. Scout
  reads one window, or photographs it, only when you ask about it.
- Ask "tell me when the build finishes" and Scout starts a watch that stops on its own. With
  screen memory on, it answers "what was on screen a few minutes ago?" and "what changed?". It
  zooms in on small text and looks at another monitor when asked.
- Keep an eye on things: every few seconds Scout looks at window titles only. After you settle on
  something new, or a title looks like an error, it may read that window and say one short line,
  at most once every 10 minutes, never during calls or full screen.
- Scout talks: you may not be looking at the screen, so Scout says its bubble lines aloud
  (answers, the hello, a remark, an expert that finished), in a calm, refined, dry British voice.
  Only the first sentence or two; code, lists and long text stay in the bubble.
- Talk to Scout: hold a key (or click the mic) and ask out loud. It should feel like talking to a
  person, not an agent: Scout answers in short spoken sentences, starts speaking on the first one,
  asks one question back at most and leaves detail in the bubble. Talking cuts Scout off. Scout
  listens continuously only after you switch Always listening on, once, in the bubble. It stays
  on until you switch it off, and Scout never switches it on itself. A clear mark on Scout shows
  the whole time. Listening pauses while a call or a full-screen window is in front, and while
  the pets are hidden. Scout acts only on what starts with its name ("Scout, what is this?");
  everything else is dropped on the computer and goes nowhere. "Scout, stop" switches it off. Audio is understood on the computer and never sent or
  stored. Otherwise the microphone opens only on the talk key or the mic in the text box, and
  those need no name. The bubble offers the key to reply.
- The bubble's header has Always listening (off by default) and Seeing (sight on or paused);
  Settings has both, plus who speaks and who listens.
- Home, the control centre: Overview, Scout (how it thinks), Experts, Routines, Connections,
  Activity (every hand-off and its thread), Settings.
- Routines: when + what + where the result goes. A schedule (daily, weekdays, chosen days at a
  time) or a trigger (Tagalong opens, an app or site appears, an expert finishes, a watch fires);
  the instruction runs as a Scout turn; the result goes to the bubble, voice or a Windows
  notification, and always to Activity. Set one up in Home → Routines from a template, or ask Scout,
  which shows a routine card that saves nothing until Save. Saving is consent for the routine's
  read-only work; changes still ask every time, and a hand-off runs without a card only for the
  expert the card named, read-only with no project.
- Settings leads with how Scout thinks (its real brain and whether the Claude sign-in works), then
  privacy, voice, shortcuts and the browser extension; the tuning knobs (summaries, API keys, the
  ElevenLabs voice, sight detail, watches) sit under Advanced, closed by default, with a short line
  visible and the longer story behind ⓘ.
- The Chrome extension hands Scout the page and selection from Chrome's side panel.

## Capabilities and Constraints

- Scout thinks with the Claude sign-in when available, or an API key for Anthropic, OpenRouter or
  Nebius Token Factory. A cheaper model can be set for summaries, greetings and remarks.
- Experts are added from Home; Claude Code is the first kind. Add expert starts from a template
  (Coder, Debugger, Designer, Researcher, or Blank) with standing instructions you can read and
  change. Each task asks which project to work in, guessed from the screen.
- Built-in blind spots (password managers, sign-in prompts, secret files, private windows,
  authenticator apps, remote desktop) are never seen, titles included; your own exclusions add to
  them.
- Everything is stored locally. Screenshots are not kept by default.
- A new install is set up by Scout itself in one window: no Next button, each question asked
  aloud and in its bubble, answered by voice, typing or a tap; the step chips go back, and closing
  resumes at the same step. It first asks "Talk or type?": "Talk to me" is setup's permission to
  use the microphone, and it listens for your answers only from then on, with the speech model
  ready before the mic opens. No microphone, a refused permission or a model that will not
  download is said plainly, and setup carries on by typing. It asks your name plainly and says
  why ("Rather not" means it is never asked again), checks the real Claude sign-in (suggests it,
  waits for a sign-in, or offers install or an API key, which is tested once with one tiny
  request), plays a sample voice line, teaches the one key beside an Always listening switch
  (off by default; Scout never switches it on itself), then lands in the corner and invites one real question. Each later launch it says
  one short line that fits what happened: the time of day, days away with the hand-offs and
  routines that finished, a crash and what it cut short, an update and what is new, or, plainly
  with a fix, that it is signed out or has no key. It fades, reads no screen for this, and
  Settings turns it off.
- Scout can know your name: optional in setup ("Rather not" is remembered), editable in Settings → You. It
  uses it rarely (a hello, a moment that warrants it), and the invitation and the launch line
  greet you by it.
- Speech runs on the computer (Kokoro, downloaded on first use); ElevenLabs is an optional
  bring-your-own-key voice that receives only the words spoken. Speech to text runs on the
  computer too (Moonshine, with Silero VAD and Smart Turn, downloaded on first use); the words show
  in the bubble as you talk, and the audio is never sent or stored.
- Connections: Scout uses the person's apps over MCP (Notion, GitHub, Linear, the servers already
  in Claude Code, or any MCP server). It reads on its own; every change shows a confirm card and
  runs only on Allow once. Tokens live in the OS keychain.
- Spend: Home's Overview shows what Scout and the experts used today and this month (dollars for
  priced models, tokens for the Claude sign-in and unknown models). An optional daily budget pauses
  keep-an-eye comments and scheduled routines once it is spent; asking Scout always works.
- Not built yet: speech to text through ElevenLabs, expert templates, macOS and
  Linux. Google Calendar and Gmail are not in Popular: their official MCP servers are a developer
  preview that needs your own Google Cloud project. The roadmap lives in Notion.

## Brand Commitments

- Name: **Tagalong**. The companion: **Scout** (a default the user can rename).
- Voice: **warm and playful**. A companion with personality, friendly and a little fun, never
  childish. Anything about privacy, keys, cost or errors stays plain and exact.
- Look: a **pixel-art feel** for Scout's figure. No logo, colours or fonts are fixed yet.

## Evidence on Hand

- Working Windows build with Scout, sight, keep an eye, voice, experts (Claude Code), connected
  apps (MCP), Home and the Chrome extension.
- No users, testimonials, metrics or press yet. Do not invent any.

## Product Principles

1. **Present, never intrusive.** Always one key away, never in the way; it speaks up rarely and
   never takes over your mouse or keyboard.
2. **Plain by default, deep on request.** The first layer is for anyone; detail is one step in.
3. **Ask before acting.** Nothing is handed to an expert, written or sent without your OK.
4. **Show the work.** Every hand-off and its result is visible in Activity, one click from the
   answer.
5. **Your machine, your keys, your data.** Local first, honest about cost and what leaves the
   computer; blind spots are never seen.

## Accessibility & Inclusion

Keyboard-first throughout. Animation must respect reduced-motion. Status must never rely on colour
alone. Spoken lines always appear in the bubble too.
