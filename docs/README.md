# Tagalong engineering docs

How Tagalong is built: the processes, the packages, the wire protocol and each subsystem, with the files, data flow, limits and storage. The code on `main` is the source of truth; each doc cites the files it describes. Start with [architecture.md](architecture.md). Product intent is in [bodies/PRODUCT.md](../bodies/PRODUCT.md) and the visual design in [bodies/DESIGN.md](../bodies/DESIGN.md).

## Reading paths

- **New here.** [architecture.md](architecture.md), then [principles.md](principles.md), then [development.md](development.md) to run it, then [../protocol/README.md](../protocol/README.md).
- **Working on the brain.** [brain/README.md](brain/README.md), [brain/turns.md](brain/turns.md), [brain/tasks.md](brain/tasks.md), [brain/permissions.md](brain/permissions.md), [brain/experts.md](brain/experts.md), then [data/storage.md](data/storage.md) and [data/memory.md](data/memory.md).
- **Working on a body.** [bodies/desktop.md](bodies/desktop.md), [bodies/browser.md](bodies/browser.md) or [bodies/whatsapp.md](bodies/whatsapp.md); then [senses/bubble.md](senses/bubble.md) and [senses/sight.md](senses/sight.md); Scout's figure is drawn by the mascot engine in [bodies/mascot.md](bodies/mascot.md).
- **Changing the contract.** [../protocol/README.md](../protocol/README.md) first (it carries a typical session), then `protocol/ts`, `brain/src/brain/protocol.py` and `protocol/examples` together.
- **Voice.** [senses/hearing.md](senses/hearing.md), [senses/speaking.md](senses/speaking.md), [senses/stt-results.md](senses/stt-results.md), then the [Voice section](../protocol/README.md#voice) of the protocol.

Before changing a feature, read its doc and run its section of [testing/feature-test-guide.md](testing/feature-test-guide.md).

## The whole system

| Doc                                            | Covers                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| [architecture.md](architecture.md)             | The at-a-glance diagram, processes and start-up, packages, one request  |
| [principles.md](principles.md)                 | One brain and many bodies, what code decides versus what the model does |
| [development.md](development.md)               | Build, run, test, package, CI and the conventions                       |
| [../protocol/README.md](../protocol/README.md) | Contract v1 between the brain and the bodies: the source of truth       |

## brain/

| Doc                                          | Covers                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [brain/README.md](brain/README.md)           | The Python brain: how to run it, its files, hello and the Home tools |
| [brain/turns.md](brain/turns.md)             | The event log, the runner (`pick`, `gate`, `target`) and a turn      |
| [brain/tasks.md](brain/tasks.md)             | Tasks, work rows and open items                                      |
| [brain/experts.md](brain/experts.md)         | Jobs and hand-offs to Claude Code and others over ACP                |
| [brain/permissions.md](brain/permissions.md) | Tool modes, asks and the one permission engine                       |
| [brain/setup.md](brain/setup.md)             | Installing experts and apps, the `tagalong` command                  |
| [brain/safety.md](brain/safety.md)           | Budget, guards, masking and retries                                  |
| [brain/loops.md](brain/loops.md)             | Loops, mail and timers                                               |

## senses/

| Doc                                            | Covers                                                |
| ---------------------------------------------- | ----------------------------------------------------- |
| [senses/sight.md](senses/sight.md)             | Window list, captures, OCR, exclusions, pausing sight |
| [senses/hearing.md](senses/hearing.md)         | The talk key, the brain's ears, always listening      |
| [senses/speaking.md](senses/speaking.md)       | The brain's mouth, chunks, playback, the system voice |
| [senses/bubble.md](senses/bubble.md)           | The companion bubble, status marks, drops             |
| [senses/stt-results.md](senses/stt-results.md) | Speech-model measurements                             |

## bodies/

| Doc                                                  | Covers                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| [bodies/desktop.md](bodies/desktop.md)               | The Electron body: windows, tray, hotkeys, IPC, packaging |
| [bodies/browser.md](bodies/browser.md)               | The browser body: identity, its four tools, permissions   |
| [bodies/whatsapp.md](bodies/whatsapp.md)             | The WhatsApp body: webhook, Graph send, 24-hour window    |
| [bodies/mascot.md](bodies/mascot.md)                 | The mascot engine: specs, moods, props                    |
| [bodies/connected-apps.md](bodies/connected-apps.md) | MCP connections, tool calls, approvals                    |

## data/

| Doc                                                          | Covers                                              |
| ------------------------------------------------------------ | --------------------------------------------------- |
| [data/storage.md](data/storage.md)                           | Every store by kind: tables, files, secrets, caches |
| [data/memory.md](data/memory.md)                             | The memory store, recall, summaries, forgetting     |
| [data/privacy.md](data/privacy.md)                           | What is captured, sent, kept and deleted            |
| [data/settings-and-secrets.md](data/settings-and-secrets.md) | The settings store and secrets on the way out       |

## Testing and publishing

| Doc                                                                      | Covers                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| [testing/feature-test-guide.md](testing/feature-test-guide.md)           | Manual test steps for each feature                |
| [chrome-web-store/listing.md](chrome-web-store/listing.md)               | The Chrome Web Store listing and submission steps |
| [chrome-web-store/privacy-policy.md](chrome-web-store/privacy-policy.md) | The extension's public privacy policy             |
