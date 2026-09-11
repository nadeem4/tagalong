# Tagalong design (2026-09-11)

Canonical, detailed plan lives in Notion: https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc
This file is the local copy of the approved design so the repo is self-describing.

## Pitch

Tagalong is a crew of AI companions ("pets") that tag along on your screen. They see what you are
looking at, answer in text or voice, remember context, talk to each other, and act on your behalf
through MCP tools, never by taking over your mouse or keyboard.

## Use cases

Reading (explain/summarize/translate the highlighted text or visible page), coding (errors, diffs,
functions on screen), writing (proofread, draft replies), research (collect highlights into Notion via
MCP), productivity (calendar/tickets via MCP), learning (quiz, explain), accessibility (read aloud,
describe images, voice-first), crew workflows (handoff, consult, roundtable).

## Architecture: core engine + thin hosts (pnpm monorepo)

- packages/protocol: Zod schemas (ContextSnapshot, Pet, Message) + JSON-RPC method catalog. Depends only on zod.
- packages/core: Tagalong Engine. Pure Node TypeScript. Pets, ConversationRunner, PromptAssembler,
  Memory (SQLite + FTS5), voice pipeline, PetBus (handoff/consult/roundtable), McpManager + ApprovalPolicy,
  providers (Brain/STT/TTS), WebSocket JSON-RPC server. Never imports electron, react, or DOM APIs.
- packages/ui: React components shared by hosts (avatar, chat panel, composer, context chip, approval card, crew view).
- apps/desktop: Electron host. Runs the engine in main, exposes ws://127.0.0.1:47321 with a pairing token,
  transparent always-on-top avatar + panel windows, hotkeys, tray, safeStorage secrets, platform/{win32,darwin,linux}.
- apps/extension: Chrome MV3 host (Phase 6). Connects to the running engine; supplies exact selection/page text; side panel UI.

Hosts implement two contracts: Perception (selection, active window, screenshot, clipboard, page text)
and Presentation (render pets, stream replies, play audio, approval cards).

## AI engine options

Claude Max plan credentials cannot be used by Tagalong: Anthropic's Claude Code legal page
(code.claude.com/docs/en/legal-and-compliance) restricts subscription OAuth to Claude Code and native
Anthropic apps and directs developers (including Agent SDK users) to API keys.
BrainProvider interface, chosen per pet: anthropic (default; API key), ollama (local, free), openai-compatible, fake (tests).
Default models: claude-opus-5 (pets), claude-sonnet-5 (Scout / fast pets), claude-haiku-4-5 (background summaries).
Adaptive thinking, streaming, prompt caching of persona + tools.

## Voice

Whisper (OpenAI API) behind SttProvider; ElevenLabs streaming behind TtsProvider. Sentence-level streaming,
push-to-talk, barge-in. Reply styles per pet: text, voice-summary (default), voice-full.

## Pets and crew

Pet = name, avatar, voice, persona, model, provider, tool allowlist, reply style, private memory.
Shared crew notebook. Defaults: Scout (explainer), Ink (writer), Bolt (coder).
Handoff (thread summary to another pet), Consult (ask_pet tool, depth 1, 60 s timeout), Roundtable (max 3 rounds).

## Actions

MCP servers from mcp.json; per-pet allowlist; read tools auto-run; write tools need an approval card
(once / always / deny, 120 s timeout = deny); action log. No mouse/keyboard automation, ever.

## Privacy

Capture only on request with a visible indicator; app exclusion list; local SQLite; screenshots not persisted
by default; keys in OS keychain.

## Phases

0 Setup, 1 Foundation, 2 Sight, 3 Voice, 4 Crew, 5 Hands, 6 Browser Host, 7 Polish and Cross-platform.
Each phase page in Notion has step-by-step instructions and an acceptance script. Tasks board: Tagalong Tasks.

## Conventions

TDD always; never overengineer; core stays pure; docs updated with every change; Conventional Commits;
Mermaid diagrams in black and white.
