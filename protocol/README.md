# Tagalong contract v1

The wire contract between the brain (Python) and its bodies (desktop, extension, later phone).
This file is the source of truth: the TypeScript package in `ts/` (`@tagalong/contract`), the Python types in `brain/src/brain/protocol.py`
and the samples in `examples/` follow it, and a change here comes first. The sample file convention is in [examples/README.md](examples/README.md).

## Principles

- Bodies talk only to the brain, never to each other.
- The contract carries facts and the model's own words, never canned lines. Every word Scout says comes from the model; a turn may end with no reply at all.
- The fourteen messages below do not change when a body, tool, expert or Home screen is added. New things arrive as tools, event names or `changed` names, never as new messages.
- Single user: no TLS, pairing or accounts in v1.

## Transport

- One websocket per body, JSON-RPC 2.0, one JSON object per text frame. Default address `ws://127.0.0.1:47321`; the brain's address is configurable so it can run on another machine.
- Heartbeat is the websocket ping. A body that stops answering pings is offline.
- Unknown fields are ignored by both sides. Field names are `snake_case`.
- Optional fields are omitted when absent, never sent as `null`; a `null` on an optional field gets `invalid_params`. The only nullable fields are `turn.body` and `reply.body` (always present, may be `null`) and the free-form `data` and `context`.
- Either side may send requests. Request ids are chosen by the sender (string or integer) and only need to be unique per connection and direction.
- The first message on a connection must be `hello`. Anything else before it gets `invalid_request` and the connection is closed.

## Versioning

One integer, `protocol`, currently `1`. If the body's `protocol` differs from the brain's, `hello` fails with `version_mismatch` (the error's `data.protocol` is the brain's version) and the brain closes the connection. The body tells the user to update. Adding an optional field does not bump the version; removing or changing the meaning of one does.

## Shared shapes

```text
Tool  { name, description, input_schema, confirm? }
Part  { type: "text", text }
    | { type: "image", mime, data }
    | { type: "file",  mime, name?, data }
Body  { id, kind, name }
```

- **Tool.** `name` is unique within the body that declares it: lowercase letters, digits, `_` and `-`, never `__`, at most 48 characters. `input_schema` is a JSON Schema object. `confirm: true` means the brain always asks the user before running it (see Asks).
- **Tool names across bodies.** Bodies declare plain names (`see_screen`). The brain exposes them to the model as `<body id>__<name>` (`desktop__see_screen`) so two bodies never collide and the name stays within the model API's allowed characters. The brain calls the body with the plain name. Brain tools have no prefix and never contain `__`.
- **Part.** `data` is base64. A future source, `ref` (an uploaded file id instead of `data`), is reserved: v1 senders always send `data`, and v1 receivers reject a part with `ref` and no `data` with `invalid_params`. Adding `ref` later needs no message change.
- **Body.** `id` is stable for that install (for example `desktop`): lowercase letters, digits and `-`, at most 32 characters; `kind` is the body type (`desktop`, `extension`), `name` is for people (`Desktop`).

## Limits

| What                              | Limit                                                        | Error        |
| --------------------------------- | ------------------------------------------------------------ | ------------ |
| One part's decoded `data`         | 5 MB                                                         | `over_limit` |
| All parts in one message, decoded | 20 MB                                                        | `over_limit` |
| Replay window                     | the last 500 notifications or 24 hours, whichever is smaller | `resync`     |

The same caps apply to `output` parts returned from `use` and `call`.

## Messages

Request means a JSON-RPC request that gets a result or an error. Notification means no reply.

### Body → brain

| Method     | Kind         | Params                                               | Result                                              |
| ---------- | ------------ | ---------------------------------------------------- | --------------------------------------------------- |
| `hello`    | request      | `{ protocol, body: Body, tools: Tool[], last_seq? }` | `{ protocol, session, tools: Tool[], seq, resync }` |
| `tools`    | request      | `{ tools: Tool[] }`                                  | `{}`                                                |
| `say`      | request      | `{ text?, parts?: Part[], context?, spoken? }`       | `{ turn, joined }`                                  |
| `event`    | notification | `{ name, data? }`                                    |                                                     |
| `call`     | request      | `{ tool, input }`                                    | `{ output: Part[] }`                                |
| `answer`   | request      | `{ ask, option, text? }`                             | `{}`                                                |
| `cancel`   | notification | `{ turn }`                                           |                                                     |
| `progress` | notification | `{ call, text }`                                     |                                                     |

- **hello.** Opens the connection. `tools` are the body's tools. The result carries the brain's own tools (the ones a body may `call`), the shared `session` id, the latest `seq` in this body's outbox, and `resync` (see Replay). A second `hello` on the same connection gets `invalid_request`.
- **tools.** The body's tool list changed; it replaces the whole list.
- **say.** The user said something. At least one of `text` or `parts` is present. `context` is free-form (active window, selection) and goes to the model as-is; each body documents its own context in its doc, never here. `spoken: true` means the user spoke, so the body will speak the reply itself (voice stays in the desktop body in v1; the brain only sees text). The result returns the `turn` id at once; the reply streams as notifications. If a turn is already running (from any body), the message joins it instead of starting a new one: the result carries that turn's id and `joined: true`, and the model sees the new message at its next step. If the daily budget is spent, the turn still starts and ends at once with `reason: "over_budget"`, so every body learns it the same way.
- **event.** A fact the body noticed (window changed, user idle). Names are free-form and documented per body. The brain decides whether it matters; most events get no reaction.
- **call.** The body runs one of the brain's tools directly (Home reading settings, for example). Unknown tool gets `unknown_tool`.
- **answer.** The user answered an ask. `option` is one of the ask's `options` strings; `text` is optional free text. An ask that is already closed or never existed gets `not_found`; an `option` not in the list gets `invalid_params`.
- **cancel.** Stop this turn. The brain ends it with `turn { state: "ended", reason: "cancelled" }`. A turn that has already ended or never existed is ignored.
- **progress.** A short status line for a `use` that is still running (`call` is the `use` call id). The brain may show it to the model or the user; it never replaces the result. An unknown call id is ignored.

### Brain → body

| Method    | Kind         | Params                                                                                                                                        | Result               |
| --------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `use`     | request      | `{ call, tool, input }`                                                                                                                       | `{ output: Part[] }` |
| `cancel`  | notification | `{ call }`                                                                                                                                    |                      |
| `reply`   | notification | `{ seq, turn, body, delta }` or `{ seq, turn, body, done: true }`                                                                             |                      |
| `turn`    | notification | `{ seq, turn, body, state: "started" \| "ended", reason? }`                                                                                   |                      |
| `tool`    | notification | `{ seq, turn, call, name, state: "started" \| "ended", ok?, summary? }`                                                                       |                      |
| `ask`     | notification | `{ seq, id, state: "open", turn?, text, options: string[], confirm?, tool?, input? }` or `{ seq, id, state: "closed", reason, option?, by? }` |                      |
| `changed` | notification | `{ seq, what }`                                                                                                                               |                      |

- **use.** Run one of this body's tools. `tool` is the plain name the body declared. On failure the body returns an error: `tool_failed`, `cancelled`, `timeout` or `invalid_params`.
- **cancel.** Stop that `use`. The body answers the `use` with `cancelled`, or with its result if it had already finished.
- **reply.** Scout's words for a turn, streamed. `body` follows the same rule as `turn.body`, so it is `null` for a brain-started turn with no body online. Zero or more `delta` chunks, then exactly one `done` if any delta was sent. A turn that ends with no `reply` at all is a silent turn, and that is allowed.
- **turn.** A turn started or ended. `body` is the body the user was talking to: it shows and speaks the reply; other bodies may show it in history. For a turn the brain starts itself, `body` is the body the user last talked to if it is online, otherwise any online body, otherwise `null`. `reason` on `ended` is one of `done`, `cancelled`, `error`, `over_budget`, `step_cap`.
- **tool.** A tool call in a turn started or ended, so bodies can show what Scout is doing. `name` is the full name as the model sees it. `summary` is a short line for people; it comes from the tool's result, not a template.
- **ask.** Scout needs the user. `state: "open"` carries the question; every connected body shows it. When the ask closes, the brain sends `state: "closed"` to every body so the prompt disappears everywhere. `reason` is `answered`, `timeout` or `cancelled`; with `answered`, `option` is the chosen option and `by` is the body id that answered. First answer wins. For a confirm (see Asks and confirm) the ask has `confirm: true`, `tool` and `input`, and its options are exactly `["allow", "deny"]`.
- **changed.** Something the bodies display changed (`settings`, `memory`, an expert's name). `what` is free-form, never a fixed list. Bodies refetch through `call`.

## Sessions and turns

- There is one session across all bodies, and it survives a brain restart. A second body joins the same conversation; `hello` returns its id. The id is informational in v1: bodies never send it back.
- One turn runs at a time. A turn starts with `say`, or with the brain itself (a scheduled routine, for example), which waits until no turn is running. A `say` during a running turn joins it (see `say`). Every notification about a turn carries its `turn` id.
- Every brain → body notification goes to every connected body. `use` and its `cancel` go only to the body that owns the tool.
- Two connections with the same body id: the newer `hello` wins and the brain closes the older connection. Running `use` calls on the old connection fail with `body_offline`.

## Seq, outbox and replay

- Every brain → body notification except `cancel` carries `seq`: an integer that rises by one per notification in that body's outbox, starting at 1. Bodies process notifications in `seq` order.
- The brain keeps an outbox per body id (the replay window in Limits). A body that reconnects sends `last_seq` in `hello`.
- If every notification after `last_seq` is still in the outbox, the brain answers `hello` with `resync: false` and then sends them in order before anything new.
- If some are gone (too old, too many, the brain restarted, or `last_seq` is higher than the brain's latest `seq`), the brain answers `resync: true`. The body drops what it was showing for open turns and asks. The brain then sends only what is still live: an `ask` (`open`) for every open ask and a `turn` (`started`) for every turn that has not ended. These are new notifications with fresh `seq` numbers after the one in the `hello` result.
- A first `hello` with no `last_seq` gets `resync: false` and only live state, as above.

## Asks and confirm

- A tool with `confirm: true` is never run without asking: code guards, not the model. The brain pauses the call and sends an `ask` with `confirm: true`, `tool`, `input` and options `["allow", "deny"]`. Bodies show those two as their own buttons.
- The ask's `text` is the model's own words from the step that made the call (for example "I'll delete these 3 old logs"), with no extra model call and no template. If the model wrote nothing, `text` is empty and the body shows the tool and its input.
- `deny` fails the call with `denied`; no answer in time fails it with `timeout`. The model is told either way.
- Every other ask is the model's own: it words the question and chooses the options.

## Errors

JSON-RPC error objects: `{ code, message, data? }`. `message` is a plain sentence for logs; bodies show their own words, never `message`.

| Name               | Code   | When                                                                  |
| ------------------ | ------ | --------------------------------------------------------------------- |
| `parse_error`      | -32700 | The frame is not valid JSON                                           |
| `invalid_request`  | -32600 | Not a valid request, or a message before `hello`, or a second `hello` |
| `method_not_found` | -32601 | Unknown method                                                        |
| `invalid_params`   | -32602 | Params do not match this spec                                         |
| `internal_error`   | -32603 | A bug on the receiving side                                           |
| `version_mismatch` | -32000 | `hello` with another `protocol`; `data.protocol` is the brain's       |
| `unknown_tool`     | -32001 | `call` or `use` names a tool that does not exist                      |
| `not_found`        | -32002 | An ask, turn or call id that does not exist or is already closed      |
| `denied`           | -32003 | The user refused a confirm                                            |
| `timeout`          | -32004 | A tool or ask took too long                                           |
| `cancelled`        | -32005 | The work was cancelled                                                |
| `body_offline`     | -32006 | The body went offline while a `use` was running                       |
| `tool_failed`      | -32007 | The tool ran and failed; `data` may carry details                     |
| `over_limit`       | -32008 | A part or message is over the size limits                             |

## Examples

A desktop connects, the user asks for something on screen, Scout looks and answers.

```json
→ {"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocol":1,"body":{"id":"desktop","kind":"desktop","name":"Desktop"},"tools":[{"name":"see_screen","description":"Capture the screen","input_schema":{"type":"object","properties":{}}}]}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":1,"session":"s1","tools":[],"seq":0,"resync":false}}
→ {"jsonrpc":"2.0","id":2,"method":"say","params":{"text":"what's this error?","context":{"window":"VS Code"}}}
← {"jsonrpc":"2.0","id":2,"result":{"turn":"t1","joined":false}}
← {"jsonrpc":"2.0","method":"turn","params":{"seq":1,"turn":"t1","body":"desktop","state":"started"}}
← {"jsonrpc":"2.0","method":"tool","params":{"seq":2,"turn":"t1","call":"c1","name":"desktop__see_screen","state":"started"}}
← {"jsonrpc":"2.0","id":"b1","method":"use","params":{"call":"c1","tool":"see_screen","input":{}}}
→ {"jsonrpc":"2.0","id":"b1","result":{"output":[{"type":"image","mime":"image/png","data":"iVBORw0..."}]}}
← {"jsonrpc":"2.0","method":"tool","params":{"seq":3,"turn":"t1","call":"c1","name":"desktop__see_screen","state":"ended","ok":true}}
← {"jsonrpc":"2.0","method":"reply","params":{"seq":4,"turn":"t1","body":"desktop","delta":"That's a missing import"}}
← {"jsonrpc":"2.0","method":"reply","params":{"seq":5,"turn":"t1","body":"desktop","done":true}}
← {"jsonrpc":"2.0","method":"turn","params":{"seq":6,"turn":"t1","body":"desktop","state":"ended","reason":"done"}}
```

A confirm answered on one body closes on all of them.

```json
← {"jsonrpc":"2.0","method":"ask","params":{"seq":7,"id":"a1","state":"open","turn":"t2","text":"I'll delete these 3 old logs.","options":["allow","deny"],"confirm":true,"tool":"desktop__delete_files","input":{"paths":["a","b","c"]}}}
→ {"jsonrpc":"2.0","id":3,"method":"answer","params":{"ask":"a1","option":"deny"}}
← {"jsonrpc":"2.0","id":3,"result":{}}
← {"jsonrpc":"2.0","method":"ask","params":{"seq":8,"id":"a1","state":"closed","reason":"answered","option":"deny","by":"desktop"}}
```

A body that is too far behind.

```json
→ {"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocol":1,"body":{"id":"extension","kind":"extension","name":"Chrome"},"tools":[],"last_seq":12}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":1,"session":"s1","tools":[],"seq":740,"resync":true}}
```

## Left to the builder

- How the outbox is stored (memory or disk); a brain restart may simply mean `resync`.
- Timeouts for `use` and for asks, and the exact JSON Schema subset tools may use.
- How the brain turns events, context and tool results into model input.
