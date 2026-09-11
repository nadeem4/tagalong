# Tagalong architecture

Adapted from the project home in Notion:
<https://app.notion.com/p/3d809730490481a4be8ac5bd000b8bfc>

## Core engine, thin hosts

One core engine, many thin hosts. The core never knows which OS or which host it is talking to.

`packages/core` is the whole engine: pets, the conversation loop, prompt assembly, memory, the voice
pipeline, the inter-pet bus, the MCP client, and the provider adapters. It runs as pure Node
TypeScript and exposes itself to hosts through a WebSocket JSON-RPC server.

A host is a thin shell around that engine. It captures what the user is looking at and renders what the
pets say. `apps/desktop` runs the engine in the Electron main process; `apps/extension` connects to an
already-running engine over the socket. Adding a host, or adding an operating system, never touches the
core.

## Components

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#000000", "secondaryColor": "#ffffff", "tertiaryColor": "#ffffff", "background": "#ffffff", "clusterBkg": "#ffffff", "clusterBorder": "#000000"}}}%%
flowchart LR
  subgraph Hosts
    D["apps/desktop<br>Electron host<br>Perception + Presentation"]
    E["apps/extension<br>Chrome host<br>Perception + Presentation"]
  end
  subgraph Core["packages/core: Tagalong Engine"]
    S["WebSocket JSON-RPC server"]
    R["ConversationRunner"]
    P["PromptAssembler"]
    M["Memory: SQLite + FTS5"]
    B["PetBus: handoff, consult, roundtable"]
    T["McpManager + ApprovalPolicy"]
    PR["Providers: Brain, STT, TTS"]
  end
  subgraph External
    C["Claude API"]
    V["ElevenLabs and Whisper"]
    X["MCP servers: Notion, Gmail, Calendar, files"]
  end
  D -- "ws://127.0.0.1" --> S
  E -- "ws://127.0.0.1" --> S
  S --> R
  R --> P
  R --> M
  R --> B
  R --> T
  R --> PR
  PR --> C
  PR --> V
  T --> X
```

## Package responsibilities

| Package           | Responsibility                                                                                                                                                           | Must never import                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| packages/protocol | Zod schemas for context snapshots, pets, messages, and the JSON-RPC method catalog                                                                                       | anything except zod                              |
| packages/core     | Pets, conversation loop, prompt assembly, memory, voice pipeline, inter-pet bus, MCP client, host protocol server, provider adapters                                     | electron, react, DOM globals                     |
| packages/ui       | React components: avatar, chat panel, composer, context chip, approval card, crew view, settings panels                                                                  | electron                                         |
| apps/desktop      | Electron host. Runs the engine in the main process, exposes the localhost socket, transparent overlay windows, hotkeys, tray, secret storage, one platform folder per OS | nothing from core internals, only its public API |
| apps/extension    | Chrome MV3 host. Connects to the running engine, supplies exact page text and selection, renders pets in the side panel                                                  | core at all; it speaks the protocol only         |

## Host contracts

Hosts implement two contracts.

- **Perception** answers capture requests: selection, active window, screenshot, clipboard, page text.
  The result is a `ContextSnapshot` defined in `packages/protocol`.
- **Presentation** renders pets, streams replies, plays audio, and shows approval cards.

Adding a host or an OS never touches the core.

## Host transport

Hosts talk to the engine over a JSON-RPC WebSocket bound to loopback only: `ws://127.0.0.1:47321`. The
connection is authenticated with a pairing token, so only hosts that hold the token can drive the
engine. Every method and payload on that socket is defined in `packages/protocol`.

## The ask flow

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#000000", "actorBkg": "#ffffff", "actorBorder": "#000000", "signalColor": "#000000", "signalTextColor": "#000000", "noteBkgColor": "#ffffff", "noteBorderColor": "#000000"}}}%%
sequenceDiagram
  participant U as User
  participant H as Host
  participant C as Core engine
  participant A as Claude
  participant T as Text to speech
  U->>H: highlight text, press hotkey or hold push to talk
  H->>H: build ContextSnapshot
  H->>C: ask(petId, input, snapshot)
  C->>C: assemble prompt: persona + memory + context
  C->>A: streaming request with tools
  A-->>C: text deltas and tool calls
  C-->>H: turn.delta
  C->>T: complete sentences
  T-->>C: audio chunks
  C-->>H: turn.audio
  H-->>U: streamed text and speech, interruptible
```
