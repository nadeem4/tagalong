# Protocol

> This page describes the current TypeScript protocol in `packages/protocol`. The new contract v1 for the Python brain is [protocol/README.md](../protocol/README.md); it replaces this protocol when the rewrite lands. Its TypeScript schemas are the `@tagalong/contract` package in `protocol/ts`, its Python types are `brain.protocol` in `brain/src/brain/protocol.py`, and the shared samples are in `protocol/examples`. `packages/protocol` goes away when the bodies switch to the new contract. Contract v1 adds an `approved` notification (sent when Scout approves an ask under a preference) and `changed {what: "approvals"}`; they are not in this page's catalog.

## Purpose

`packages/protocol` is the wire contract between the engine and every host: the JSON-RPC
envelopes, the catalog of methods and notifications with a zod schema for each, and the shared
schemas they carry (context snapshot, pet, message, settings). Both sides validate every message
against it. It depends on `zod` and nothing else, so the Electron host, the Chrome host and the
engine all load the same file.

How the socket itself works (loopback, pairing, scoping, timeouts) is in
[architecture.md](architecture.md#host-transport).

## Where it lives

| File                                                                                   | What it holds                                                                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                                         | `PROTOCOL_VERSION`, `ENGINE_HOST`, `DEFAULT_ENGINE_PORT`, `engineUrl`; re-exports every module                              |
| `src/rpc.ts`                                                                           | `RpcRequest`, `RpcNotification`, `RpcResponse`, `RpcError`, `RPC_ERROR_CODES`                                               |
| `src/methods.ts`                                                                       | `HostCapability`, the three catalog objects, the turn and perception schemas, typed lookups                                 |
| `src/context.ts`                                                                       | `ContextSnapshot`, `ContextSnapshotPatch`, `CapturedImage`, `DisplaySnapshot`, `WindowEntry`, `Dropped`, `PerceptionTarget` |
| `src/pet.ts`, `src/message.ts`                                                         | `Pet`, `SCOUT_ID`; `Message`, `MessageContent`, `Conversation`                                                              |
| `src/settings.ts`                                                                      | `Settings`, `SETTINGS_DEFAULTS`, `SettingsPatch`, `CaptureExclusions`, `CaptureBlock`, `SettingsProposedParams`             |
| `src/limits.ts`                                                                        | Character caps shared by hosts and engine (published as the `./limits` subpath)                                             |
| `src/roles.ts`                                                                         | `Role`, `ModelTier` (published as the `./roles` subpath)                                                                    |
| `src/activity.ts`, `experience.ts`, `self.ts`, `memory.ts`, `sight-log.ts`, `usage.ts` | Home's records                                                                                                              |
| `src/experts.ts`, `pick-up.ts`                                                         | Experts, briefs, hand-offs, projects, pick-up items                                                                         |
| `src/asks.ts`, `connections.ts`, `routines.ts`, `awareness.ts`                         | Asks, connected apps, routines and the calendar link, recall, diff and watches                                              |
| `src/blind-spots.ts`, `status.ts`, `voice.ts`, `addressing.ts`                         | Shared non-wire helpers: built-in blind spots, status marks, voice adapter facts, "Scout," addressing                       |

## The envelope

JSON-RPC 2.0, one JSON object per WebSocket text message (`src/rpc.ts`).

| Shape        | Fields                                                         | Notes                                                                              |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Request      | `jsonrpc: '2.0'`, `id` (string or number), `method`, `params?` | Either side may send one: hosts call the engine, the engine asks hosts to perceive |
| Notification | `jsonrpc: '2.0'`, `method`, `params?`, no `id`                 | Engine to host only; never answered                                                |
| Response     | `jsonrpc: '2.0'`, `id`, exactly one of `result` or `error`     | `RpcResponse` refuses a response with both or neither                              |
| Error        | `code` (integer), `message`, `data?`                           | The engine never sets `data`                                                       |

`RPC_ERROR_CODES`:

| Code     | Name             | When the engine sends it (`server/ws-server.ts`)                                                                                   |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `-32700` | `parseError`     | The message was not valid JSON                                                                                                     |
| `-32600` | `invalidRequest` | Valid JSON, not a JSON-RPC request                                                                                                 |
| `-32601` | `methodNotFound` | Not in `hostToCoreMethods`, or catalogued but no handler wired                                                                     |
| `-32602` | `invalidParams`  | Params failed the catalog schema (the message lists each `path: issue`), or a handler's `RpcFailure` such as "there is only Scout" |
| `-32603` | `internalError`  | A handler threw anything other than `RpcFailure`                                                                                   |
| `-32000` | `unauthorized`   | Wrong pairing token, any method before `hello`, or a method the extension may not call                                             |

Engine-to-host request ids are strings of the form `<kind>-<n>` (`capture-1`, `readText-2`),
numbered per session. The engine reads a request with no `params` as `{}`, and answers a
handler that returns nothing with `result: {}`.

## The catalog

`src/methods.ts` holds three objects. Each entry names its params schema and, for requests, its
result schema:

- `hostToCoreMethods`: 62 requests a host sends to the engine.
- `coreToHostMethods`: 8 requests the engine sends to a host.
- `coreToHostNotifications`: 23 notifications the engine sends to hosts.

`paramsSchemaFor`, `resultSchemaFor` and `notificationParamsSchemaFor` accept only catalogued
names, so an unknown name is a compile error; `ParamsOf<M>`, `ResultOf<M>` and
`NotificationParamsOf<N>` give the inferred types. Unless a row says otherwise, a host-to-core
method is desktop only; the extension may call `ask`, `interrupt` and `pets.list`
(`EXTENSION_METHODS` in `packages/core/src/server/ws-server.ts`). The handlers are in
`buildHandlers` in `packages/core/src/engine.ts`.

In the tables, `{}` is an empty object and `?` marks an optional field.

### Session

| Method  | Params                                                                                  | Result                                                                | Host |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---- |
| `hello` | `host` (`desktop` or `extension`), `version`, `capabilities: HostCapability[]`, `token` | `sessionId` (uuid), `engineVersion`, `protocolVersion`, `pets: Pet[]` | both |

`hello` is answered by `EngineServer` itself, not a handler. `HostCapability` is `selection`,
`screenshot`, `activeWindow`, `clipboard`, `pageText`, `displays`, `textLayer`, `recall`,
`pointer`.

### Turns and pets

| Method        | Params                                                                                        | Result                                                           | Host    |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- |
| `ask`         | `petId`, `conversationId?` (uuid), `input: { text }`, `snapshot?: ContextSnapshot`, `spoken?` | `{ turnId }`                                                     | both    |
| `interrupt`   | `turnId`                                                                                      | `{ aborted }`                                                    | both    |
| `pets.list`   | `{}`                                                                                          | `{ pets }`                                                       | both    |
| `pets.upsert` | `pet: Pet`                                                                                    | `{ pet }`; `-32602` unless the id is `scout` and the role exists | desktop |
| `watch.stop`  | `watchId`                                                                                     | `{ stopped }`                                                    | desktop |

`ask` returns a receipt; the answer arrives as `turn.*` notifications
([architecture.md](architecture.md#the-life-of-one-turn)).

### Settings and brains

| Method            | Params                            | Result                                                                            |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `settings.get`    | `{}`                              | `{ settings: Settings }`                                                          |
| `settings.set`    | `patch: SettingsPatch`, `byTalk?` | `{ settings }`; `byTalk` writes a "Changed by talk" sight-log row naming the keys |
| `models.list`     | `providerId`                      | `{ models: string[], source: 'live' \| 'fallback' }`                              |
| `providers.check` | `providerId`                      | `{ ok: true }` or `{ ok: false, message }`                                        |

### Asks and approvals

| Method         | Params                                     | Result                              |
| -------------- | ------------------------------------------ | ----------------------------------- |
| `tool.approve` | `approvalId`, `decision: 'once' \| 'deny'` | `{ accepted }`                      |
| `asks.list`    | `{}`                                       | `{ waiting: Ask[], recent: Ask[] }` |
| `asks.answer`  | `id`, `decision: 'approve' \| 'decline'`   | `{ accepted }`                      |
| `asks.open`    | `id`                                       | `{ opened }`                        |

See [asks.md](asks.md).

### Home's records

| Method             | Params                                    | Result                                                                   |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| `activity.list`    | `before?`, `limit` (1 to 100, default 30) | `{ entries: ActivityEntry[], next? }`                                    |
| `experience.list`  | `before?`, `limit` (1 to 100, default 30) | `{ episodes: Episode[], next? }`                                         |
| `experience.get`   | `id`                                      | `{ episode, events }` or `null`                                          |
| `experience.clear` | `{}`                                      | `{ deleted }`                                                            |
| `memory.list`      | `before?`, `limit` (1 to 200, default 50) | `{ memories: { id, kind, text, createdAt }[], next? }`                   |
| `memory.delete`    | `id`                                      | `{ deleted }`                                                            |
| `sightLog.list`    | `limit` (1 to 1000, default 200)          | `{ entries: SightLogEntry[] }`                                           |
| `sightLog.delete`  | `id`                                      | `{ deleted }`                                                            |
| `sightLog.clear`   | `{}`                                      | `{ deleted }`                                                            |
| `usage.summary`    | `{}`                                      | `{ today, month: UsageRow[], todayUsd, budget: { dailyUsd, spentOut } }` |
| `hosts.status`     | `{}`                                      | `{ extension }`: whether a browser extension session is connected        |

See [memory.md](memory.md), [sight.md](sight.md) and [mind.md](mind.md).

### The Self

| Method        | Params         | Result                                              |
| ------------- | -------------- | --------------------------------------------------- |
| `self.list`   | `{}`           | `{ pages: SelfPage[], nights: SelfNight[] }`        |
| `self.get`    | `path`         | `{ path, text, versions: SelfVersion[] }` or `null` |
| `self.write`  | `path`, `text` | `{ ok, reason?, note? }`                            |
| `self.undo`   | `versionId`    | `{ ok, reason? }`                                   |
| `self.accept` | `versionId`    | `{ ok, reason? }`                                   |
| `self.reject` | `versionId`    | `{ ok, reason? }`                                   |

See [mind.md](mind.md).

### Experts and hand-offs

| Method             | Params                                                                                       | Result                                  |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `experts.list`     | `{}`                                                                                         | `{ experts: Expert[] }`                 |
| `experts.upsert`   | `expert: Expert`                                                                             | `{ expert }`                            |
| `experts.delete`   | `expertId`                                                                                   | `{ deleted }`                           |
| `experts.test`     | `expertId`                                                                                   | `{ ok, error? }`                        |
| `experts.catalog`  | `{}`                                                                                         | `{ entries: CatalogStatus[] }`          |
| `experts.install`  | `catalogId`                                                                                  | `{ ok, installed: PluginId[], error? }` |
| `handoffs.confirm` | `proposalId`, `folder?`, `canEdit`, `brief?: Brief`, `then?` (`{ canEdit, ask? }` or `null`) | `{ handoffId }`                         |
| `handoffs.dismiss` | `proposalId`                                                                                 | `{ dismissed }`                         |
| `handoffs.cancel`  | `handoffId`                                                                                  | `{ cancelled }`                         |
| `projects.search`  | `query` (at most 200 characters)                                                             | `{ projects: ProjectCandidate[] }`      |
| `pickUp.rebrief`   | `itemId`                                                                                     | `{ proposed }`                          |
| `pickUp.dismiss`   | `{}`                                                                                         | `{ dismissed }`                         |

See [experts.md](experts.md).

### Check-ins

| Method              | Params                                                                       | Result                                                            |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `checkIn.launch`    | `launch: { crashed, lastVersion \| null, version, releaseNotes, welcomed? }` | `{}`, at once; any line follows as `pet.remark` or `pickUp.ready` |
| `keepAnEye.observe` | `windows: WindowEntry[]`                                                     | `{}`                                                              |
| `keepAnEye.notNow`  | `{}`                                                                         | `{ quietUntil }`                                                  |
| `keepAnEye.accept`  | `remarkId`                                                                   | `{ proposed }`                                                    |
| `wellbeing.observe` | `idleMs`, `windows: WindowEntry[]`                                           | `{}`                                                              |

See [mind.md](mind.md).

### Connected apps

| Method                   | Params                                                                                                                       | Result                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `connections.list`       | `{}`                                                                                                                         | `{ connections: ConnectionState[], popular, found }` |
| `connections.add`        | `name`, `transport` (`http` with an https or loopback URL, or `stdio`), `auth` (`oauth`, `token`, `none`), `id?`, `secrets?` | `{ connection }`                                     |
| `connections.setEnabled` | `id`, `enabled`                                                                                                              | `{ connection }`                                     |
| `connections.signIn`     | `id`                                                                                                                         | `{ connection }`                                     |
| `connections.remove`     | `id`                                                                                                                         | `{ removed }`                                        |

See [connected-apps.md](connected-apps.md).

### Routines

| Method                | Params                                                    | Result                         |
| --------------------- | --------------------------------------------------------- | ------------------------------ |
| `routines.list`       | `{}`                                                      | `{ routines: RoutineView[] }`  |
| `routines.save`       | `routine` (a `RoutineDraft` plus `id?`)                   | `{ routine }`                  |
| `routines.delete`     | `id`                                                      | `{ deleted }`                  |
| `routines.setEnabled` | `id`, `enabled`                                           | `{ routine }`                  |
| `routines.runNow`     | `id`                                                      | `{ started }`                  |
| `routines.confirm`    | `proposalId`, `routine?`                                  | `{ routine?, deleted? }`       |
| `routines.dismiss`    | `proposalId`                                              | `{ dismissed }`                |
| `calendar.setLink`    | `link`: an https URL (at most 2,000 characters) or `null` | `{ linked, meetings, error? }` |
| `calendar.check`      | `{}`                                                      | `{ linked, meetings, error? }` |

See [routines.md](routines.md).

### Core to host requests

The engine sends these to one session (`HostSession` in `ws-server.ts`) and parses the answer
against the result schema before using it. Each has 5 s to answer.

| Method                     | Params                                                                                                           | Result                                                                    | Asked of a host advertising |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| `perception.capture`       | `what: PerceptionTarget[]` (at least one)                                                                        | `{ snapshot: ContextSnapshotPatch }`                                      | the target's capability     |
| `perception.listWindows`   | `{}`                                                                                                             | `{ windows: WindowEntry[], displays?: ScreenInfo[] }`                     | `displays`                  |
| `perception.readText`      | `windowId?` (foreground when absent), `maxChars` (default 8,000, at most 40,000)                                 | `{ windowId, text, truncated, source: 'uia' \| 'ocr', blocked?, notes? }` | `textLayer`                 |
| `perception.captureRegion` | `displayId`, `rect`, `maxLongSide`                                                                               | `{ image: CapturedImage }`                                                | `displays`                  |
| `perception.captureWindow` | `windowId`, `maxLongSide`                                                                                        | `{ windowId, image?, blocked?, notes? }`                                  | `displays`                  |
| `perception.recall`        | `secondsAgo`, `displayId?`                                                                                       | `{ recording, oldestAt?, capturedAt?, frames, windows, focusedWindow? }`  | `recall`                    |
| `perception.diff`          | `displayId`, `sinceSeconds`, `rect?`, `includeImages` (default true)                                             | `{ changeRatio (0 to 1), beforeAt?, afterAt, bounds?, before?, after? }`  | `recall`                    |
| `screen.pointAt`           | `{ windowId, name, label? }` or `{ displayId, rect, label? }`; `label` at most 40 characters (`POINT_LABEL_MAX`) | `{ shown, screen?, blocked?, notes? }`                                    | `pointer`                   |

`PerceptionTarget` is `selection`, `screenshot`, `activeWindow`, `clipboard`, `pageText`,
`displays`, `windows`. The extension answers only `perception.capture`. See [sight.md](sight.md).

### Notifications

The engine validates each one against its schema before sending (`SessionImpl.notify`) and
broadcasts it to every authenticated session, except `settings.proposed`, which goes to desktop
sessions only. A host drops a notification whose name it does not know.

| Notification          | Params                                                                                                                                          | Sent when                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `turn.started`        | `turnId`, `petId`, `conversationId`, `providerId?`, `model?`, `routineId?`, `background?: true`, `jobId?`, `spoken?: true`                      | A turn begins                                                                         |
| `turn.delta`          | `turnId`, `text`                                                                                                                                | Each streamed text chunk                                                              |
| `turn.toolRequest`    | `turnId`, `approvalId`, `callId?`, `tool`, `input`                                                                                              | A tool call is about to run                                                           |
| `turn.toolResult`     | `turnId`, `callId?`, `tool`, `ok`, `summary`                                                                                                    | A tool call ended; `summary` is a short gist, not the content                         |
| `turn.completed`      | `turnId`, `text`, `stopReason` (`end`, `max_tokens`, `aborted`, `refusal`, `tool_limit`), `usage: { inputTokens, outputTokens }`, `modelCalls?` | The turn ended; `refusal` and `tool_limit` carry empty text                           |
| `turn.error`          | `turnId`, `code`, `message`                                                                                                                     | The turn failed; ends it                                                              |
| `turn.warning`        | `turnId`, `code`, `message`                                                                                                                     | Something to show that does not end the turn (`vision_unsupported`)                   |
| `watch.fired`         | `watchId`, `petId`, `condition`, `message` (may be empty), `displayId`                                                                          | A watch's condition was met                                                           |
| `watch.status`        | `watchId`, `petId`, `condition`, `displayId`, `state`, `checks`, `maxChecks`, `checkModel?`, `detail?`                                          | A watch changed state                                                                 |
| `handoff.proposed`    | `proposalId`, `petId`, `expertId`, `expertName`, `brief`, `projects`, `canEdit`, `ownFolder?`, `restored?`, `then?`                             | A hand-off card waits for Send                                                        |
| `handoff.progress`    | `handoffId`, `expertId`, `step`, `kind?` (`tool`, `say`, `note`, `delivered`, `dropped`)                                                        | An expert reported a step                                                             |
| `handoff.finished`    | `handoffId`, `expertId`, `state` (`done`, `error`, `stopped`), `text?`, `changedFiles?`, `error?`, `next?`                                      | An expert finished                                                                    |
| `pet.remark`          | `remarkId`, `petId`, `text`, `offer?`, `handoffId?`                                                                                             | A check-in produced a line                                                            |
| `pet.mood`            | `petId`, `mood` (`wince`, `cheer`, `tired`, `rested`)                                                                                           | A check-in chose a face                                                               |
| `connections.changed` | `connections: ConnectionState[]`                                                                                                                | Any connection changed                                                                |
| `connector.confirm`   | `approvalId`, `turnId`, `petId`, `app`, `tool`, `summary`, `risk?`, `options?`                                                                  | A change in a connected app waits for the person (`options`: the Python brain's ask)  |
| `connector.dismiss`   | `approvalId`                                                                                                                                    | A brain ask's card closed; only the bubble reads it, Home ignores it                  |
| `asks.changed`        | `waiting: Ask[]`                                                                                                                                | What waits on the person changed                                                      |
| `routine.proposed`    | `proposalId`, `petId`, `action` (`create`, `update`, `pause`, `resume`, `delete`), `routine`, `routineId?`, `handToName?`                       | A routine card waits for Save                                                         |
| `routine.result`      | `routineId`, `name`, `petId`, `conversationId?`, `state`, `line`, `text`, `late`, `deliver`, `activityId?`                                      | A routine finished                                                                    |
| `routines.changed`    | `{}` (loose: extra keys pass)                                                                                                                   | Home should list routines again                                                       |
| `pickUp.ready`        | `text`, `items: PickUpItem[]` (at least one)                                                                                                    | Back after a break, with something to pick up                                         |
| `settings.proposed`   | `proposalId`, `petId`, `patch: SettingsPatch`, `rows` (at least one)                                                                            | Scout wants to change settings; the host applies with `settings.set { byTalk: true }` |
| `board.changed`       | `running`, `queued`                                                                                                                             | Scout's own background jobs changed                                                   |

## Main schemas

### ContextSnapshot (`src/context.ts`)

What a host saw when the person asked. Only the identity triple is required, because hosts
advertise different capabilities.

| Field         | Type                                                                           | Notes                                                                                          |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `id`          | uuid                                                                           |                                                                                                |
| `capturedAt`  | ISO datetime                                                                   |                                                                                                |
| `host`        | `desktop` or `extension`                                                       | `HostKind`                                                                                     |
| `app?`        | `{ name, windowTitle?, blocked?: CaptureBlock }`                               | A blocked window arrives with no title, so the engine still knows to refuse                    |
| `selection?`  | string, at most 20,000 characters (`MAX_SELECTION_CHARS`)                      |                                                                                                |
| `clipboard?`  | string                                                                         |                                                                                                |
| `page?`       | `{ url, title, text }`, text at most 40,000 characters (`MAX_PAGE_TEXT_CHARS`) | Extension only                                                                                 |
| `screenshot?` | `CapturedImage`                                                                | One picture                                                                                    |
| `displays?`   | `DisplaySnapshot[]`                                                            | `{ id, bounds, scaleFactor, primary, focused, blocked?, image? }`; a display may have no image |
| `composite?`  | `CapturedImage`                                                                | Every display drawn into one picture                                                           |
| `windows?`    | `WindowEntry[]`                                                                | The inventory, never window text                                                               |
| `dropped?`    | `Dropped`                                                                      | `{ kind: text \| link \| file \| image, name?, path?, size?, text?, image? }`                  |

`CapturedImage` is `{ mime: 'image/png', base64, width, height }`: PNG only.
`WindowEntry` is `{ id, processName, title, displayId?, state: foreground | background |
minimized, browser, textChars?, blocked?, fullScreen? }`; `id` is opaque and only the host that
issued it can resolve it, and a blocked window never carries `textChars`.
`ContextSnapshotPatch` (`ContextSnapshot.partial()`) is what `perception.capture` returns.

### Pet (`src/pet.ts`)

| Field         | Type   | Notes                                                                     |
| ------------- | ------ | ------------------------------------------------------------------------- |
| `id`          | string | Always `scout` (`SCOUT_ID`); `pets.upsert` refuses anything else          |
| `name`        | string |                                                                           |
| `avatar`      | string | Emoji or an asset key the host renders                                    |
| `roleId`      | string | A role library id; `companion` for Scout                                  |
| `model`       | string | The model that answers turns                                              |
| `watchModel?` | string | The small model for a watch's checks; absent means the provider's default |
| `providerId`  | string | `claude-code`, `openrouter`, `anthropic` or `fake`                        |

### Message and Conversation (`src/message.ts`)

`Message` is `{ id, conversationId, role: user | assistant, content: MessageContent[] (at least
one), snapshot?: ContextSnapshot, createdAt }`. `MessageContent` is a discriminated union on
`type`:

| `type`        | Fields                                         |
| ------------- | ---------------------------------------------- |
| `text`        | `text`                                         |
| `image`       | `mime` (`image/png` or `image/jpeg`), `base64` |
| `tool_use`    | `id`, `name`, `input`                          |
| `tool_result` | `toolUseId`, `content` (string), `isError?`    |

`Conversation` is `{ id, petId, title (default null), createdAt }`. The block shape is
provider-neutral: the store and every provider read and write the same thing. Storage is in
[storage.md](storage.md).

## Constants and limits

| Constant                    | Value                      | File             |
| --------------------------- | -------------------------- | ---------------- |
| `PROTOCOL_VERSION`          | `0.23.0`                   | `src/index.ts`   |
| `ENGINE_HOST`               | `127.0.0.1`                | `src/index.ts`   |
| `DEFAULT_ENGINE_PORT`       | `47321`                    | `src/index.ts`   |
| `MAX_SELECTION_CHARS`       | 20,000                     | `src/limits.ts`  |
| `MAX_PAGE_TEXT_CHARS`       | 40,000                     | `src/limits.ts`  |
| `DEFAULT_WINDOW_TEXT_CHARS` | 8,000                      | `src/limits.ts`  |
| `MAX_WINDOW_TEXT_CHARS`     | 40,000 (same as page text) | `src/limits.ts`  |
| `POINT_LABEL_MAX`           | 40                         | `src/methods.ts` |

## Versioning and compatibility

- `PROTOCOL_VERSION` is bumped whenever the catalog changes shape. The engine reports it in
  `hello`'s result; neither host compares it or refuses a mismatch. The desktop bundles the engine
  and the protocol into one build, so the two always match there. The extension is built from the
  same repo but installed separately, so it is the one host that can run against a different
  engine version.
- Params and results are `z.object`, which strips unknown keys rather than refusing them, so a
  newer host sending an extra field is accepted. A missing or malformed required field is
  `-32602`.
- A host ignores a notification name it does not know (`EngineClient`, `EngineConnection`), so
  adding a notification never breaks an older host.
- Stored data is read with the same leniency: a `Pet` saved with since-removed fields still
  parses, and `Settings` drops retired keys through `preprocess` steps (`withoutRetiredTalkKey`,
  `withoutRetiredBaseUrls`, `withoutRetiredSummarizer`) and fills missing ones from
  `SETTINGS_DEFAULTS`.
- The workspace packages are private and versioned `0.0.0`; nothing is published to a registry.

## Where settings live

The `Settings` schema, `SETTINGS_DEFAULTS` and `SettingsPatch` are in `src/settings.ts`. A patch
is built from the validators without defaults, so parsing one never invents values; everything
omitted keeps its current value. The engine's `SettingsStore` (`packages/core/src/settings/settings.ts`)
keeps them in `settings.json` in the data folder. Secrets are never in settings: they live in the
host's `SecretStore`. Both are described in [settings-and-secrets.md](settings-and-secrets.md).

## How to add a method

1. **Schemas.** Add `XParams` and `XResult` (or `XParams` alone for a notification) as zod
   objects in the area's file under `packages/protocol/src`, exported from `src/index.ts`'s
   re-exports.
2. **Catalog.** Add the entry to `hostToCoreMethods`, `coreToHostMethods` or
   `coreToHostNotifications` in `src/methods.ts`.
3. **Pin it.** Add the name to `HOST_TO_CORE` or `CORE_TO_HOST_NOTIFICATIONS` in
   `src/methods.test.ts`; the "covers the table exactly" test fails until both lists agree.
   (`CORE_TO_HOST` only checks that its names exist.) Add schema tests beside the others.
4. **Version.** Bump `PROTOCOL_VERSION` in `src/index.ts`.
5. **Engine.**
   - Host-to-core: add the handler in `buildHandlers` (`packages/core/src/engine.ts`).
     `MethodHandlers` makes every handler optional, so a missing one compiles and answers
     `-32601` "not wired up". Throw `RpcFailure` for a refusal the host should show.
   - Core-to-host: add a method to `HostSession` and `SessionImpl` in `server/ws-server.ts`
     that sends the request and parses the result, and add a `HostCapability` if hosts must opt in.
   - Notification: emit through `live.server?.broadcast(...)` or `session.notify(...)`.
6. **Extension.** Only if the side panel needs it, add the name to `EXTENSION_METHODS` and update
   the scoping tests in `packages/core/src/server/ws-server.test.ts`.
7. **Hosts.** The desktop calls through `EngineClient.call` from an IPC handler in
   `bodies/desktop/src/main/ipc/`, exposed by the preload; a core-to-host request is answered in
   `EngineClient`'s `#answer` (and `service-worker.ts` for the extension). A notification the UI
   renders joins `TurnNotification` in `bodies/ui/src/host-bridge.ts` (every `turn.*` joins
   automatically).
8. **Docs.** Add the row to the tables above and to the subsystem doc that owns it.

## Tests that pin it

| Test                                                                                          | Pins                                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/methods.test.ts`                                                       | The exact host-to-core and notification lists; each method's params and result shapes                     |
| `packages/protocol/src/methods.types.test-d.ts`                                               | Unknown method names and notification-as-method lookups fail `pnpm typecheck`                             |
| `packages/protocol/src/rpc.test.ts`                                                           | The envelopes, including "exactly one of result or error"                                                 |
| `packages/protocol/src/context.test.ts`, `pet.test.ts`, `message.test.ts`, `settings.test.ts` | The main schemas and their caps and defaults                                                              |
| `packages/protocol/src/index.test.ts`                                                         | `PROTOCOL_VERSION` is semver; the loopback URL                                                            |
| `packages/core/src/server/ws-server.test.ts`                                                  | Pairing, hello deadline and size cap, extension scoping, every error code, core-to-host result validation |
| `apps/extension/src/engine-connection.test.ts`                                                | The extension's hello, calls and answers                                                                  |
