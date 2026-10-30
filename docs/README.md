# Tagalong engineering docs

How Tagalong is built: the processes, the packages, the wire protocol and each subsystem, down to
files, data flow, limits, storage and the tests that pin behaviour. The code on `main` is the
source of truth; each doc cites the files it describes. How to build and run from source is in
[development.md](development.md).

## Index

### The whole system

| Doc                                            | Covers                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [architecture.md](architecture.md)             | Processes, packages and import rules, host contracts, the host transport, the life of one turn, boot and shutdown, the subsystem map |
| [protocol.md](protocol.md)                     | `packages/protocol`: the JSON-RPC envelope, every method and notification, the main schemas, versioning, adding a method             |
| [../protocol/README.md](../protocol/README.md) | Contract v1 between the Python brain and the bodies: the rewrite's source of truth                                                   |
| [brain.md](brain.md)                           | The Python brain: how to run it, its files, hello and tools, the outbox and replay, what is not built yet                            |
| [principles.md](principles.md)                 | The rules the rewrite follows: one brain and many bodies, what code does versus what the model decides, no technical debt            |

### Hosts

| Doc                                | Covers                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [desktop.md](desktop.md)           | The Electron host: windows, tray, hotkeys, IPC modules, the platform adapter, settings applied live, packaging, the log file |
| [bubble.md](bubble.md)             | The companion bubble in `bodies/ui`: status marks, pointing, drafts, drops                                                   |
| [voice.md](voice.md)               | Hearing and speaking: the talk key, always listening, follow-up, barge-in, models and downloads, the voice process           |
| [browser-body.md](browser-body.md) | The browser body: identity, its four tools, right-click and address-bar asks, permissions, popup, install                    |

### The engine

| Doc                                    | Covers                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [sight.md](sight.md)                   | Perception: window list, captures, OCR, exclusions, attach policy, pausing sight, the sight log, rolling memory |
| [memory.md](memory.md)                 | The memory store, recall, the digest, summaries, forgetting, retention                                          |
| [connected-apps.md](connected-apps.md) | MCP connections, tool calls, approvals for writes                                                               |

### Foundations

| Doc                                                | Covers                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [settings-and-secrets.md](settings-and-secrets.md) | The settings store, changing settings by talking, the secret store, secrets on the way out |
| [privacy.md](privacy.md)                           | What is captured, sent, kept and deleted                                                   |

### Working on the code

| Doc                                                                      | Covers                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [development.md](development.md)                                         | Repository layout, running, environment variables, adding a host, provider or tool, conventions |
| [testing/feature-test-guide.md](testing/feature-test-guide.md)           | Manual test steps for each feature, with setup, action and expected result                      |
| [chrome-web-store/listing.md](chrome-web-store/listing.md)               | The Chrome Web Store listing and submission steps                                               |
| [chrome-web-store/privacy-policy.md](chrome-web-store/privacy-policy.md) | The extension's public privacy policy                                                           |

## Reading order

For an engineer new to the repo:

1. [architecture.md](architecture.md): the processes, the packages and one turn end to end.
2. [development.md](development.md): get it running locally.
3. [protocol.md](protocol.md): the contract every host and the engine share.
4. [memory.md](memory.md): what happens inside a turn and what is kept.
5. [sight.md](sight.md) and [privacy.md](privacy.md): what is read from the screen and the rules
   around it.
6. [desktop.md](desktop.md), [bubble.md](bubble.md) and [voice.md](voice.md): the desktop host.
7. The rest as needed: [brain.md](brain.md), [connected-apps.md](connected-apps.md),
   [browser-body.md](browser-body.md), [settings-and-secrets.md](settings-and-secrets.md).

Before changing a feature, read its subsystem doc and run its section of
[testing/feature-test-guide.md](testing/feature-test-guide.md).
