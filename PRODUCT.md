# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Rendered with web technology inside an Electron desktop app (Windows 11 today; macOS and Linux
later) and a Chrome extension that works without a screen of its own. Desktop conventions apply: tray, global hotkeys,
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

Not a chat window you go to: a companion that sits with you. Scout reads or photographs a window only when it matters, speaks up rarely, and never takes over your
mouse or keyboard. Experts do the heavy lifting in the background; Home shows every hand-off and
its result.

## Operating Context

- Runs all day in the background: tray icon, Scout docked on the desktop, a bubble that opens
  beside it on a hotkey and hides on Escape.
- Hotkeys: `Ctrl+Shift+Space` ask (brings the selected text and the window you are on),
  `Ctrl+Shift+Alt+P` pause sight, `Ctrl+Shift+Alt+M` stop speaking, Right Ctrl held on its own
  to talk to Scout.
- "What do you see?" is answered per screen from the window list, without a screenshot. Scout
  reads one window, or photographs it, only when you ask about it.
- Ask "tell me when the build finishes" and Scout sets a timer that checks and tells you. It
  zooms in on small text and looks at another monitor when asked.
- Scout talks: you may not be looking at the screen, so Scout says its bubble lines aloud
  (answers, the hello, a remark, an expert that finished), in a calm, refined, dry British voice.
  Scout decides what to say; code and long lists it puts in a block, shown and not read.
- Talk to Scout: hold a key (or click the mic) and ask out loud. It should feel like talking to a
  person, not an agent: Scout answers in short spoken sentences, starts speaking on the first one,
  asks one question back at most and leaves detail in the bubble. Talking cuts Scout off. Scout
  listens continuously only after you switch Always listening on, once, in the bubble. It stays
  on until you switch it off, and Scout never switches it on itself. A clear mark on Scout shows
  the whole time. Listening pauses while a call or a full-screen window is in front, and while
  the pets are hidden. Scout acts only on what starts with its name ("Scout, what is this?");
  everything else is dropped on the computer and goes nowhere. "Scout, stop" switches it off. Audio goes only to your own brain and is never
  stored; with the brain on this computer it never leaves it. Otherwise the microphone opens only on the talk key or the mic in the text box, and
  those need no name. The bubble offers the key to reply.
- The bubble's header has Always listening (off by default) and Seeing (sight on or paused);
  Settings has both, plus who speaks and who listens.
- Home, the control centre: Overview, Jobs, Connections, Approvals, what Scout remembers,
  Settings.
- Settings: privacy, voice, shortcuts and the browser extension, each with a short line visible and the longer story behind ⓘ.
- The Chrome extension is a tools-only body, with no display: Scout can see and manage your tabs when
  you allow it, and you can ask Scout from a right-click on selected text or the address bar.

## Capabilities and Constraints

- Scout thinks with an Anthropic API key set in the brain's environment.
- Experts: Claude Code is the first kind, reached over ACP on the user's own Claude login. Scout
  hands it a task for a folder on this computer; Home's Jobs page shows each one.
- Built-in blind spots (password managers, sign-in prompts, secret files, private windows,
  authenticator apps, remote desktop) are never seen, titles included; your own exclusions add to
  them.
- Everything is stored locally. Screenshots are not kept by default.
- There is no setup window. Start the brain, then Tagalong; Scout appears on the screen. The
  brain's model and key live in its `.env`. The body never speaks as Scout; only the mind does.
- Speech runs on the computer (Kokoro, downloaded on first use). Speech to text runs on the
  computer too (Moonshine, with Silero VAD and Smart Turn, downloaded on first use); the words show
  in the bubble as you talk. Audio goes only to your own brain and is never stored; with the brain
  on this computer it never leaves it.
- Connections: Scout uses the person's apps over MCP (Notion, GitHub, Linear, the servers already
  in Claude Code, or any MCP server). It reads on its own; every change shows a confirm card and
  runs only on Allow once. Tokens stay in the brain's data folder.
- Spend: Home's Overview shows what Scout spent today against a daily limit. At the limit Scout
  pauses for the day.
- Not built yet: macOS and Linux. Google Calendar and Gmail are not in Popular: their official MCP servers are a developer
  preview that needs your own Google Cloud project. The roadmap lives in Notion.

## Brand Commitments

- Name: **Tagalong**. The companion: **Scout**.
- Voice: **warm and playful**. A companion with personality, friendly and a little fun, never
  childish. Anything about privacy, keys, cost or errors stays plain and exact.
- Look: Scout is **Bean**, a soft clay-like 3D figure, moving on the dock and still everywhere else;
  pixel type for names and titles. No logo yet.

## Evidence on Hand

- Working Windows build with Scout, sight, voice, experts (Claude Code), connected
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
