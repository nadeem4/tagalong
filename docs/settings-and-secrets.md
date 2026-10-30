# Settings and secrets

## Purpose

Settings are the person's choices, kept as one JSON file and validated by one schema shared by the
engine and every host. Secrets (API keys, connection tokens, the calendar link) never sit in that
file. They sit in the host's `SecretStore`, which on the desktop is encrypted with the OS keychain.
This doc also covers how settings change by talking, and how secrets are hidden from everything
that leaves the machine.

## Where it lives

| File                                          | What it holds                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/settings.ts`           | `Settings`, `SETTINGS_DEFAULTS`, `SettingsPatch`, the bounds, `SettingsChangeRow`, `SettingsProposedParams`, the retired-value cleaners |
| `packages/protocol/src/methods.ts`            | `settings.get`, `settings.set` (`byTalk`), `settings.proposed`                                                                          |
| `packages/core/src/settings/settings.ts`      | `SettingsStore` (`settings.json`), the `SecretStore` interface, `InMemorySecretStore`                                                   |
| `packages/core/src/engine.ts`                 | The `settings.get` and `settings.set` handlers; settings passed into stores as functions                                                |
| `packages/core/src/tools/builtin/settings.ts` | `change_settings` tool, the chat allowlist (`CHAT_SETTINGS`), `talkPatchProblem`                                                        |
| `packages/core/src/providers/presets.ts`      | `SECRET_KEYS`: where each brain's key is filed                                                                                          |
| `packages/core/src/providers/key-resolver.ts` | `KeyedProviderResolver`: reads keys before each ask, rebuilds a provider when its key or URL changes                                    |
| `packages/core/src/privacy/secrets.ts`        | `hideSecrets`                                                                                                                           |
| `packages/core/src/providers/guard.ts`        | `guardBrain`: hides secrets in every request to a model                                                                                 |
| `bodies/desktop/src/main/secret-store.ts`     | `SafeStorageSecretStore` (`secrets.json`, Electron `safeStorage`)                                                                       |
| `bodies/desktop/src/main/provider-choices.ts` | `providerChoices`, `storedKeys`, `secretKeyFor`, `forgetRetiredKeys`, `ELEVENLABS_SECRET_KEY`                                           |
| `bodies/desktop/src/main/ipc/settings.ts`     | `registerSettingsIpc`: host view, save, apply, save key, check key, model list                                                          |
| `bodies/desktop/src/main/index.ts`            | Builds the stores in `userData`; `broadcast`, `applyHotkeys`, `configureRolling` deps                                                   |

## How it works

### The schema

`settingsFields` holds the validators with no defaults. `Settings` adds a default to each field
(`.default` for scalars, `.prefault` for objects, so a missing object is filled and then validated),
and `SettingsPatch` is `z.object(settingsFields).partial()`, so parsing a patch never invents a
value. `Settings.parse({})` is the full set of defaults. Unknown keys are stripped on parse.

| Setting                        | Default                                                                                                                                              | Bounds and notes                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `enginePort`                   | 47321                                                                                                                                                | Integer, 1024 to 65535. Read once at boot                                                                                               |
| `providerBaseUrls`             | `{}`                                                                                                                                                 | Provider id to URL; absent means the preset's own URL                                                                                   |
| `pageTextBudget`               | 40,000                                                                                                                                               | Positive integer, characters of page text in a prompt                                                                                   |
| `historyMessages`              | 20                                                                                                                                                   | Positive integer, messages replayed to the model                                                                                        |
| `hotkeys`                      | `ask` `CommandOrControl+Shift+Space`, `pauseSight` `CommandOrControl+Shift+Alt+P`, `stopVoice` `CommandOrControl+Shift+Alt+M`, `talk` `RightControl` | `pauseSight`, `stopVoice`, `talk` optional; `talk` is one of `TALK_KEYS` (`RightControl`, `RightAlt`, `RightShift`, `ScrollLock`)       |
| `avatar`                       | `{ x: null, y: null }`                                                                                                                               | null docks to the default edge                                                                                                          |
| `captureExclusions`            | `{ processNames: [], titlePatterns: [] }`                                                                                                            | Trimmed, non-blank entries; built-in blind spots are separate (`BLIND_SPOTS`)                                                           |
| `screenshotRetention`          | `{ mode: 'off' }`                                                                                                                                    | Or `{ mode: 'hours', hours: 1..24 }` (`MAX_SCREENSHOT_RETENTION_HOURS`)                                                                 |
| `sightDetail`                  | `focused`                                                                                                                                            | `focused` or `all`                                                                                                                      |
| `windowTextBudget`             | 8,000 (`DEFAULT_WINDOW_TEXT_CHARS`)                                                                                                                  | Positive, at most `MAX_WINDOW_TEXT_CHARS`                                                                                               |
| `summarizer`                   | null                                                                                                                                                 | `{ providerId, model }` or null (the pet's own brain)                                                                                   |
| `rollingMemory`                | `{ enabled: false, minutes: 10 }`                                                                                                                    | Minutes 1 to 30 (`MAX_ROLLING_MEMORY_MINUTES`)                                                                                          |
| `watch`                        | `{ maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 }`                                                                                     | 1 to 500, 1 to 10, 1 to 1,440                                                                                                           |
| `welcome`                      | `{ done: false }`                                                                                                                                    | Plus optional `step` (`WELCOME_STEPS`), `answerBy`, `brain`; the desktop no longer reads or writes it                                   |
| `greeting`                     | true                                                                                                                                                 | The launch check-in                                                                                                                     |
| `lastOpenedAt`, `lastClosedAt` | null                                                                                                                                                 | ISO datetimes, written by the desktop                                                                                                   |
| `closedCleanly`                | true                                                                                                                                                 | Set false at launch, true on a clean quit                                                                                               |
| `lastVersion`                  | null                                                                                                                                                 | The version the last launch ran                                                                                                         |
| `keepAnEye`                    | true                                                                                                                                                 |                                                                                                                                         |
| `voice`                        | `{ enabled: true, voice: 'bm_george', speed: 0.95, elevenLabsVoiceId: '' }`                                                                          | `voice` in `VOICE_IDS` (`bm_george`, `bm_fable`); speed 0.7 to 1.3; optional `microphoneId`, `mouth` (`MOUTH_IDS`), `ears` (`EARS_IDS`) |
| `userName`                     | `''`                                                                                                                                                 | Trimmed, at most 40 characters (`MAX_USER_NAME_CHARS`)                                                                                  |
| `userNameDeclined`             | false                                                                                                                                                |                                                                                                                                         |
| `listening`                    | `{ always: false }`                                                                                                                                  |                                                                                                                                         |
| `pickUp`                       | true                                                                                                                                                 | Off deletes the kept snapshot                                                                                                           |
| `sightLog`                     | `{ days: 7 }`                                                                                                                                        | 1 to 30 (`MIN_SIGHT_LOG_DAYS`, `MAX_SIGHT_LOG_DAYS`)                                                                                    |
| `budget`                       | `{ dailyUsd: null }`                                                                                                                                 | Positive, at most 1,000 (`MAX_DAILY_BUDGET_USD`), or null                                                                               |
| `wellbeing`                    | `{ enabled: false }`                                                                                                                                 |                                                                                                                                         |

The schema has no secret fields (pinned by `settings.test.ts`, "carries no secret fields").

### Migrations of saved values

There is no version number in `settings.json`. Older files are cleaned on read, and the next save
writes the cleaned form:

| Cleaner                    | What it does                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Unknown keys stripped      | Drops removed fields such as `providerId`, `defaultModel`, `defaultPetId`, `hiddenPets`, the onboarding key and `hotkeys.look` |
| `withoutRetiredBaseUrls`   | Drops a `providerBaseUrls` entry for a provider in `RETIRED_PROVIDERS` (`nebius`)                                              |
| `withoutRetiredSummarizer` | A `summarizer` on a retired provider becomes null                                                                              |
| `withoutRetiredTalkKey`    | A `hotkeys.talk` that is not one of `TALK_KEYS` (an old accelerator combo) becomes `RightControl`                              |

### How settings are stored

`SettingsStore` (`core/src/settings/settings.ts`) keeps `settings.json` in the data directory
(see [storage.md](storage.md#the-data-directory)).

- `get()` reads and parses the file on every call; there is no cache. A missing file is the
  defaults. A file that is not JSON or fails the schema is logged (`[settings] ...`), and the store
  reads `settings.json.bak`, then the defaults.
- `set(patch)` validates the patch (`SettingsPatch.safeParse`; a bad patch throws
  `Invalid settings patch:` with one line per field and writes nothing), merges it **shallowly**
  over `get()` and re-parses. A patch therefore replaces a whole top-level object: every writer of
  `voice`, `hotkeys` or `welcome` spreads the current object first. It then writes
  `settings.json.tmp`, copies the current valid file to `.bak` (or moves an invalid one to
  `.corrupt`, so a hand edit with a typo is never lost), and renames the temp file over
  `settings.json`.

The engine and the desktop main process each hold a `SettingsStore` over the same file. While the
engine runs, main saves through `settings.set`; with no engine (it refused to boot), main reads and
writes the file directly, so Settings still works. Main also writes launch facts (`lastOpenedAt`,
`closedCleanly`, `lastVersion`) through `recordLaunch` before the engine boots.

### How settings are broadcast

The engine sends no notification when settings change. The desktop's save path
(`registerSettingsIpc` `save`) does the fan-out after `settings.set` answers:

1. `setSettings(saved)`: main's own copy.
2. `applyHotkeys(saved)` when the patch has `hotkeys`: rebinds the global shortcuts and points the
   key hook at the talk key.
3. `configureRolling(saved.rollingMemory)` when the patch has `rollingMemory`: starts, stops or
   trims screen memory.
4. `broadcast(saved)`: `IPC.settingsChangedEvent` to every open window. The bubble's panel listens
   (`onSettingsChanged`) for its keys, microphone and the person's name.

The `settings.set` handler in the engine also acts on what changed: with `byTalk` it records a
`changed_by_talk` row in `sight_log` (the sorted top-level setting names, never values); `pickUp`
false clears the pick-up snapshot; `wellbeing.enabled` false settles the check-in so a tired face
clears now.

### Settings that take effect without a restart

Because `SettingsStore.get()` reads the file each time, every engine-side read through
`settings.get()` is live. The engine passes settings into its parts as functions, read at use:
`sightLog.days` and `captureExclusions` (`SightLog`, history search), `budget.dailyUsd`
(`budgetSpent`), `watch` (read when a watch starts), `summarizer` (read per summary and digest),
`windowTextBudget`, `pickUp` and `providerBaseUrls` (read whenever a provider is resolved). The
runner reads the whole settings object at the start of each turn (`historyMessages`,
`screenshotRetention`, `sightDetail`, `pageTextBudget`, `userName`).

Only `enginePort` is read once, when the engine server starts. On the desktop, hotkeys and screen
memory are applied on save (above), and Always listening has its own on and off path
(`AlwaysListening`). Keys are covered in [Secrets](#secrets).

### Changed by talking

"Talk a bit slower and call me Sam" goes through `change_settings`
(`core/src/tools/builtin/settings.ts`, kind `write`). It builds a patch and shows a card. It saves
nothing.

**The chat allowlist** (`ALLOWED`, exported as `CHAT_SETTINGS`):

| Setting                                                                                               | Rule                                                                                                 | Loosens when              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| `voice.enabled`, `voice.voice`, `voice.speed`, `voice.elevenLabsVoiceId`, `voice.mouth`, `voice.ears` | One field at a time, the rest kept; `mouth` `elevenlabs` notes "Needs an ElevenLabs key in Settings" | Never                     |
| `listening.always`                                                                                    | Only `false`; `true` is refused                                                                      | Never                     |
| `userName`, `greeting`                                                                                |                                                                                                      | Never                     |
| `hotkeys.ask`, `hotkeys.pauseSight`, `hotkeys.stopVoice`                                              | Text                                                                                                 | Never                     |
| `hotkeys.talk`                                                                                        | One of `TALK_KEYS`, never a combo                                                                    | Never                     |
| `keepAnEye`                                                                                           |                                                                                                      | Turned on                 |
| `sightDetail`                                                                                         | `focused` or `all`                                                                                   | Changed to `all`          |
| `windowTextBudget`                                                                                    | Number                                                                                               | Never                     |
| `rollingMemory.enabled`, `rollingMemory.minutes`                                                      |                                                                                                      | Turned on; minutes raised |
| `screenshotRetention`                                                                                 | `"off"`, `0`, `false`, or a number of hours                                                          | Hours raised              |
| `captureExclusions.add`                                                                               | Adds an app (`*.exe`) or a title pattern; never removes                                              | Never                     |
| `wellbeing.enabled`                                                                                   |                                                                                                      | Never                     |
| `sightLog.days`                                                                                       | Only lower than now                                                                                  | Never                     |
| `pickUp`                                                                                              | Off notes "Deletes the snapshot kept now"                                                            | Turned on                 |
| `budget.dailyUsd`                                                                                     | Dollars, or `null` / `"none"` / `"off"` for no cap                                                   | Raised or removed         |

Anything else (`providerBaseUrls`, keys, logins, the model, the calendar link, `enginePort`,
removing an exclusion) is refused with one fact: the setting name (through `hideSecrets`, at most
60 characters) cannot be changed by talk, the list of what can, and where the rest is changed. The
value asked for is never echoed. The tool's deps are `{ get, emit }` only, so it has no path to the
`SecretStore`. Its description lists the current value of every allowlisted setting (through
`hideSecrets`), so Scout can answer "what's my voice speed?" without a call.

**Building the card.** For each `{ setting, value }` the tool parses the value, lays it over the
current object (`field`) or replaces the top-level value (`whole`), and makes a row
`{ setting, label, from, to, loosens, note? }`. A change that shows the same before and after is
dropped. A loosening change gets the note "Lets Scout see or keep more of your screen" (or "Lets
Scout spend more each day" for the budget). The patch is checked with `SettingsPatch.safeParse`.
No rows answers "Those settings are already that way". On a routine's own turn, any loosening row
refuses the whole call (`A routine's turn cannot loosen a setting.`). Otherwise it emits
`settings.proposed { proposalId, petId, patch, rows }` and tells the model that nothing changes
until the person clicks Apply, and that a spoken "yes" does not apply it.

**Apply.** The desktop no longer has the Apply path: its `IPC.applySettings` and
`apply-settings.ts` were deleted with the old brain, and nothing on the Python brain sends
`settings.proposed`. The tool and card above describe `packages/core`, which goes with it.

## Secrets

### SecretStore

`SecretStore` (`core/src/settings/settings.ts`) is three async methods: `get(key)` (null when
absent), `set(key, value)`, `delete(key)`. The engine never learns how secrets are protected.
Tests use `InMemorySecretStore`.

| Key                                                     | Holds                                            | Written by                                                              | Read by                                                  |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `anthropic.apiKey`, `openrouter.apiKey` (`SECRET_KEYS`) | A brain's API key                                | Desktop `IPC.saveApiKey`                                                | `KeyedProviderResolver.refresh`, `listModels`            |
| `elevenlabs.apiKey` (`ELEVENLABS_SECRET_KEY`)           | The ElevenLabs voice key                         | Desktop `IPC.saveApiKey` (`elevenlabs`)                                 | Desktop main only (the engine never reads it)            |
| `calendar.ics` (`CALENDAR_SECRET`)                      | The private calendar link                        | `calendar.setLink` (https only, at most 2,000 characters, null deletes) | `CalendarFeed`                                           |
| `connection.<id>.token`, `connection.<id>.env.<NAME>`   | A pasted app token, a local command's env values | `connections.add` (`secrets`)                                           | `ConnectionManager` when it connects                     |
| `connection.<id>.oauth`                                 | An app's OAuth client and tokens (JSON)          | The OAuth flow (`connections/oauth.ts`)                                 | The OAuth flow                                           |
| `nebius.apiKey`                                         | A retired key                                    | None                                                                    | Deleted at boot by `forgetRetiredKeys` (only if present) |

`connections.remove` deletes that connection's token, OAuth entry and env values.

### App secrets in the Python brain

The Python brain does not use `SecretStore` for connected apps. Its secrets live in the data
directory, never in the `apps` table:

| Where                 | Holds                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `app-tokens.json`     | `<id>` (bearer token), `<id>:env:<NAME>` (a literal env value), `<id>:url_query` (secret url parts) |
| `app-oauth/<id>.json` | An app's OAuth client and tokens                                                                    |

`${VAR}` references stay in the row and are filled from the brain's environment at connect. The
rules, the startup migration and the missing-key error are in [connected apps](connected-apps.md).
Text saved to disk (chat, approvals, job results, logs) has these values, and key shapes, replaced
by `[secret]`; see [privacy](privacy.md#what-is-masked-on-disk-what-is-not).

### safeStorage in the desktop

`SafeStorageSecretStore` (`bodies/desktop/src/main/secret-store.ts`) stores
`{ key: base64(safeStorage.encryptString(value)) }` in `secrets.json` in `userData`, written with
mode `0o600`. Only ciphertext is written.

- `set` refuses when `safeStorage.isEncryptionAvailable()` is false: an API key readable in the
  profile is worse than a Settings screen that says no.
- `delete` rewrites the whole file. `forgetRetiredKeys` therefore writes only when a retired key is
  actually there.
- `get` decrypts on every call. There is no cache.

### How keys are entered and never read back

Keys are typed in Settings (the keys section and the brain section), and
sent once with `saveApiKey(providerId, key)`. Main maps the provider to its secret key with
`secretKeyFor` (an unknown provider throws `'<id>' does not take an API key`, so a renderer cannot
invent an entry). An empty key deletes the stored one.

Nothing sends a key back to a renderer. `IPC.hostView` returns `providers` with `hasKey` booleans
(`storedKeys`) and `elevenLabsKeyStored`, never a value. The renderer does not receive the
`envVar` name either. `checkKey` asks the engine's `providers.check`, which tests the stored key with
one guarded (not recorded) call and answers `{ ok, message }`.

In the engine, `KeyedProviderResolver.refresh` re-reads every `SECRET_KEYS` entry at boot, before
every `ask`, and before `providers.check`, so a key saved a moment ago answers the next question
without a restart. A provider is rebuilt only when its key or base URL changed. A provider with no
key is not cached and fails its own turn (`No Anthropic API key is stored. Add one in Settings.`),
never boot. `TAGALONG_FAKE_PROVIDERS=1` ignores every key.

### Secrets on the way out

`hideSecrets(text)` (`core/src/privacy/secrets.ts`) replaces each match with `[hidden: <kind>]`:

| Rule                                                                                      | Marker         |
| ----------------------------------------------------------------------------------------- | -------------- |
| `-----BEGIN ... PRIVATE KEY-----` blocks                                                  | `private key`  |
| JSON web tokens (`eyJ...` three parts)                                                    | `login token`  |
| `sk-...` (20+), Stripe `sk_live_` / `rk_test_` style                                      | `API key`      |
| GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_`, Slack `xox?-`                   | `access token` |
| AWS `AKIA` / `ASIA` keys                                                                  | `access key`   |
| Google `AIza...`                                                                          | `API key`      |
| `scheme://user:password@host` (user and host kept)                                        | `password`     |
| `.env` lines whose name holds password, secret, token, api key, access key or private key | `secret`       |
| Quoted values of such names in code or config (unquoted identifiers kept)                 | `secret`       |
| 13 to 19 digit numbers that pass the Luhn check                                           | `card number`  |

Where it runs:

- **Every model call.** `guardBrain` (`providers/guard.ts`) wraps every provider the engine
  resolves (turns, check-ins, summaries, the digest, watches, sleep, key checks). It hides secrets
  in the system prompt, every text block, every `tool_result`, and every tool result handed back
  mid-turn through `onToolUse`. One wrapper at the provider means a new text source cannot forget.
  The resolver order is `meterBrain(recordBrain(guardBrain(provider)))`.
- **Experts.** `renderBrief` (`experts/connector.ts`) runs over the whole brief; the Claude Code
  connector hides secrets in its prompt file and in notes passed on while it works, and adds
  `Read(**/<file>)` / `Edit(**/<file>)` deny rules for every name in `SECRET_FILES`
  (see [experts.md](experts.md)). Hand-off progress steps and results are hidden too
  (`experts/handoffs.ts`).
- **Connected apps.** String arguments to app tools (`tools/builtin/connections.ts`).
- **What is kept.** `sight_log` titles, asks' summaries, job tasks and board titles, experience-log
  inputs, Self pages and reasons, digest output, history-search lines and the Now block.
- **The log file.** Every line of `logs/tagalong.log` (`bodies/desktop/src/main/log-file.ts`).

## Interfaces

### RPC methods

| Method              | Direction    | Params                                       | Result                         |
| ------------------- | ------------ | -------------------------------------------- | ------------------------------ |
| `settings.get`      | host to core | `{}`                                         | `{ settings: Settings }`       |
| `settings.set`      | host to core | `{ patch: SettingsPatch, byTalk?: boolean }` | `{ settings: Settings }`       |
| `settings.proposed` | core to host | `{ proposalId, petId, patch, rows }`         | Notification, desktop only     |
| `providers.check`   | host to core | `{ providerId }`                             | `{ ok, message }`              |
| `calendar.setLink`  | host to core | `{ link: https URL \| null }`                | `{ linked, meetings, error? }` |

The extension may call only `ask`, `interrupt` and `pets.list` (`EXTENSION_METHODS`), so it can
neither read nor change settings.

### Desktop IPC

| Channel                                                        | Handler                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `IPC.hostView`                                                 | Settings, pets, `providers` with `hasKey`, `elevenLabsKeyStored`, pairing token, hotkey problem |
| `IPC.saveSettings`                                             | `save(patch, false)`                                                                            |
| `IPC.saveApiKey` (`tagalong:secret:api-key`)                   | Stores or (empty) deletes a key                                                                 |
| `IPC.settingsChangedEvent` (`tagalong:settings-changed-event`) | Main to windows, after every save                                                               |

## Constants and limits

| Constant                              | Value           | File                                      |
| ------------------------------------- | --------------- | ----------------------------------------- |
| `MAX_SCREENSHOT_RETENTION_HOURS`      | 24              | `packages/protocol/src/settings.ts`       |
| `MAX_ROLLING_MEMORY_MINUTES`          | 30              | `packages/protocol/src/settings.ts`       |
| `MAX_USER_NAME_CHARS`                 | 40              | `packages/protocol/src/settings.ts`       |
| `MAX_DAILY_BUDGET_USD`                | 1,000           | `packages/protocol/src/settings.ts`       |
| `MIN_VOICE_SPEED` / `MAX_VOICE_SPEED` | 0.7 / 1.3       | `packages/protocol/src/settings.ts`       |
| `SIGHT_LOG_DEFAULT_DAYS`, min, max    | 7, 1, 30        | `packages/protocol/src/sight-log.ts`      |
| `DEFAULT_WINDOW_TEXT_CHARS`           | 8,000           | `packages/protocol/src/limits.ts`         |
| Refused setting name shown            | 60 characters   | `tools/builtin/settings.ts`               |
| `SETTINGS_FILENAME`                   | `settings.json` | `core/src/settings/settings.ts`           |
| `SECRETS_FILENAME`                    | `secrets.json`  | `bodies/desktop/src/main/secret-store.ts` |
| `secrets.json` file mode              | `0o600`         | `bodies/desktop/src/main/secret-store.ts` |

## Storage

`settings.json` (with `.tmp`, `.bak`, `.corrupt`) and `secrets.json` sit beside `tagalong.db` in the
data directory, `%APPDATA%\Tagalong` on Windows. Neither is in the database. See
[storage.md](storage.md).

Tool permissions (Ask or Auto per tool, shown in Home → Settings → Permissions) are not settings
here: they are brain state in the `permissions` table of `tagalong.db`, read and set through the
brain's `list_permissions` and `set_permission` (see [brain.md](brain.md#permissions-and-asks)).

Guard limits are not settings here either. The brain's spend guards take `TAGALONG_DAILY_BUDGET_USD`
and `TAGALONG_STEP_CAP`: `config.py` reads and checks them at start, and they are passed in when
`sessions.py` registers the guards (a guard never imports `config`). They live in the brain's
environment or its `.env` (see [brain.md](brain.md#run-it) and
[Guardrails](brain.md#guardrails)). The turn timeout is the same kind of setting:
`TAGALONG_TURN_TIMEOUT_S` (default 300 seconds, a positive number) is read by `config.py`, passed
to the session, and ends a Scout turn that runs too long.

## Failure handling

- **A bad settings file** never stops boot: the `.bak`, then the defaults, with a warning. The bad
  file is moved to `.corrupt` on the next save.
- **A bad patch** throws before anything is written; over RPC it comes back as an error to the
  caller. The Settings form checks its own fields first and marks a refused one
  (`SettingsFieldError`, `bodies/desktop/src/renderer/src/settings-form.ts`).
- **No engine**: settings are read and saved from the file; key checks say the engine is not
  running; the model list is empty with `source: 'fallback'`.
- **No OS encryption**: `SafeStorageSecretStore.set` throws `This machine has no OS encryption
backend, so Tagalong will not store the key.` and nothing is written.
- **An unreadable `secrets.json`** (bad JSON, or ciphertext the OS can no longer decrypt) throws from
  `get`. `forgetRetiredKeys` and the ElevenLabs lookups catch it; `storedKeys` and
  `KeyedProviderResolver.refresh` do not, so the host view or the next ask fails with that error.
- **A card patch off the allowlist** is refused whole, and listening is not switched off when the
  rest is refused (`talkPatchProblem` runs first).

## Privacy notes

The settings file holds no secrets. `userName` reaches the provider only inside Scout's prompt.
What was changed by talk is logged by name in What Scout saw, never by value. Keys never reach a
renderer, a log line or a model. See [privacy.md](privacy.md).

## Tests that pin it

| Test file                                          | Pins                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/settings.test.ts`           | Defaults, bounds, retired fields dropped, no secret fields, patch never invents values                                                                                                          |
| `packages/core/src/settings/settings.test.ts`      | Missing file, `.bak` fallback, `.corrupt`, atomic save, merge, bad patch writes nothing, retired values dropped on save, `InMemorySecretStore`                                                  |
| `packages/core/src/tools/builtin/settings.test.ts` | Card rows, keeping other fields, talk key, refusals without echo, add-only exclusions, loosening on a routine, listening off only, days lower only, budget, no secret store, `talkPatchProblem` |
| `bodies/desktop/src/main/ipc/settings.test.ts`     | Host view, no-engine mode, save fan-out (hotkeys, rolling memory, broadcast), bubble-only apply, `byTalk`, key save and delete                                                                  |
| `bodies/desktop/src/main/secret-store.test.ts`     | Round trip, survives restart, no plain text on disk, refuses with no encryption                                                                                                                 |
| `bodies/desktop/src/main/provider-choices.test.ts` | Only `hasKey` crosses, no env var name, ElevenLabs key, retired key deleted only when present                                                                                                   |
| `packages/core/src/providers/key-resolver.test.ts` | Key saved after boot used on next refresh, rebuild on key or URL change, fake mode                                                                                                              |
| `packages/core/src/privacy/secrets.test.ts`        | Each `hideSecrets` rule, ordinary text untouched                                                                                                                                                |
| `packages/core/src/providers/guard.test.ts`        | Messages and tool results hidden, images and ids kept                                                                                                                                           |
