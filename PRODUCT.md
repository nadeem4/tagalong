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
  depth (models, tools, roles).
- **Non-technical people**: anyone who reads, writes and researches at a computer and wants help
  without learning a tool.

The non-technical user sets the floor: every default, label and first-run step must make sense
without technical background. Technical depth is always available, one step further in, never in
the way.

## Product Purpose

Tagalong is a crew of AI companions that live on your screen. You highlight something, press a
key, and a pet that already sees what you are looking at answers, remembers, and works with its
teammates. It removes the copy, switch app, paste, ask, switch back loop.

Success: people keep it running all day, ask it things they would otherwise not bother to ask, and
trust it with their screen.

## Positioning

Not a chat window you go to: a team that sits with you. Each pet is a colleague with one role, a
desk, and its own memory, in a small simulated office. Pets meet in meeting rooms to work things
out and go back to their desks to do the work, and you can watch it happen, join a meeting, or
just take the final answer. It sees your screen locally, only when you ask, and never takes over
your mouse or keyboard.

## Operating Context

- Runs all day in the background: tray icon, pets docked on the desktop, a chat panel that opens
  beside the pet on a hotkey and hides on Escape.
- Hotkeys: `Ctrl+Shift+Space` ask, `Ctrl+Shift+S` look, `Ctrl+Shift+Alt+S` see everything,
  `Ctrl+Shift+Alt+P` pause sight.
- Home, the control centre: every agent, what it is doing, every handoff, consult and meeting, and
  each agent's role, model, tools and notes. Its centre scene is a theme (the Office first); the
  controls never move between themes.
- Settings and first-run ("Open your office") configure providers, keys and app-wide behaviour.
- The Chrome extension shows the same crew in Chrome's side panel.

## Capabilities and Constraints

- Pets have exactly one role each (Generalist, Backend engineer, Frontend engineer, Writer,
  Researcher at launch). Users rename pets and choose their look.
- Each pet picks its own provider and model (OpenRouter, Nebius Token Factory, Anthropic); the user
  brings their own API keys.
- Everything is stored locally. Screenshots are not kept by default.
- Not built yet: voice, MCP tools (Hands), meetings and the office window, cost dashboard, macOS and
  Linux. Designs for those are agreed but unbuilt.
- Undecided: whether users can configure the pets' personality and tone beyond the default voice.

## Brand Commitments

- Name: **Tagalong**.
- Voice: **warm and playful**. Companions with personality, friendly and a little fun, never
  childish. Anything about privacy, keys, cost or errors stays plain and exact.
- Look: a **pixel-art game feel** for the pets and the office. No logo, colours or fonts are fixed
  yet; the current mockups are placeholders.
- Default crew names (Scout, Ink, Bolt) are defaults, not commitments.

## Evidence on Hand

- Working Windows build with the crew, sight, awareness, Chrome extension and setup wizard.
- No users, testimonials, metrics or press yet. Do not invent any.

## Product Principles

1. **Present, never intrusive.** Always one key away, never in the way; nothing is read until you
   ask.
2. **Plain by default, deep on request.** The first layer is for anyone; detail is one step in.
3. **Show the work.** Every capture, consultation and meeting is visible, and the full story is
   always one click from the answer.
4. **A team, not a tool.** Pets are colleagues with roles, desks and memory; the office makes
   their work legible.
5. **Your machine, your keys, your data.** Local first, honest about cost and what leaves the
   computer.

## Accessibility & Inclusion

Keyboard-first throughout. Animation in the office must respect reduced-motion. Status must never
rely on colour alone.
