# Settings and secrets

## Purpose

Settings are the person's choices, kept as one JSON file and validated by one schema in
`bodies/desktop/src/shared/settings.ts`. The desktop owns the file; the Python brain has no settings of its own. The desktop keeps no secrets of its own. This
doc also covers how secrets are hidden in what the desktop writes to disk.

## Where it lives

| File                                        | What it holds                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `bodies/desktop/src/shared/settings.ts`     | `Settings`, `SETTINGS_DEFAULTS`, `SettingsPatch`, the bounds              |
| `bodies/desktop/src/main/settings-store.ts` | `SettingsStore` (`settings.json`), `SETTINGS_FILENAME`                    |
| `bodies/desktop/src/main/hide-secrets.ts`   | `hideSecrets`                                                             |
| `bodies/desktop/src/main/ipc/settings.ts`   | `registerSettingsIpc`: host view and save                                 |
| `bodies/desktop/src/main/index.ts`          | Builds the settings store in `userData`; `broadcast`, `applyHotkeys` deps |

## How it works

### The schema

`settingsFields` holds the validators with no defaults. `Settings` adds a default to each field
(`.default` for scalars, `.prefault` for objects, so a missing object is filled and then validated),
and `SettingsPatch` is `z.object(settingsFields).partial()`, so parsing a patch never invents a
value. `Settings.parse({})` is the full set of defaults. Unknown keys are stripped on parse.

| Setting             | Default                                                                                                                                              | Bounds and notes                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `hotkeys`           | `ask` `CommandOrControl+Shift+Space`, `pauseSight` `CommandOrControl+Shift+Alt+P`, `stopVoice` `CommandOrControl+Shift+Alt+M`, `talk` `RightControl` | `pauseSight`, `stopVoice`, `talk` optional; `talk` is one of `TALK_KEYS` (`RightControl`, `RightAlt`, `RightShift`, `ScrollLock`)       |
| `avatar`            | `{ x: null, y: null }`                                                                                                                               | null docks to the default edge                                                                                                          |
| `captureExclusions` | `{ processNames: [], titlePatterns: [] }`                                                                                                            | Trimmed, non-blank entries; built-in blind spots are separate (`BLIND_SPOTS`)                                                           |
| `voice`             | `{ enabled: true, voice: 'bm_george', speed: 0.95 }`                                                                                                 | `voice` in `VOICE_IDS` (`bm_george`, `bm_fable`); speed 0.7 to 1.3; optional `microphoneId`, `mouth` (`MOUTH_IDS`), `ears` (`EARS_IDS`) |
| `listening`         | `{ always: false }`                                                                                                                                  |                                                                                                                                         |

Those five are the whole schema. The schema has no secret fields.

### Unknown keys

There is no version number in `settings.json`. Parsing drops every key the schema does not know,
and the next save writes the cleaned form.

### How settings are stored

`SettingsStore` (`bodies/desktop/src/main/settings-store.ts`) keeps `settings.json` in the data
directory (`userData`).

- `get()` reads and parses the file on every call; there is no cache. A missing file is the
  defaults. A file that is not JSON or fails the schema is logged (`[settings] ...`), and the store
  reads `settings.json.bak`, then the defaults.
- `set(patch)` validates the patch (`SettingsPatch.safeParse`; a bad patch throws
  `Invalid settings patch:` with one line per field and writes nothing), merges it **shallowly**
  over `get()` and re-parses. A patch therefore replaces a whole top-level object: every writer of
  `voice` or `hotkeys` spreads the current object first. It then writes
  `settings.json.tmp`, copies the current valid file to `.bak` (or moves an invalid one to
  `.corrupt`, so a hand edit with a typo is never lost), and renames the temp file over
  `settings.json`.

### How settings are broadcast

The desktop's save path (`registerSettingsIpc` `save`) does the fan-out after `set` returns:

1. `setSettings(saved)`: main's own copy.
2. `applyHotkeys(saved)` when the patch has `hotkeys`: rebinds the global shortcuts and points the
   key hook at the talk key.
3. `broadcast(saved)`: `IPC.settingsChangedEvent` to every open window. The bubble's panel listens
   (`onSettingsChanged`) for its keys and microphone.

### Settings that take effect without a restart

Because `SettingsStore.get()` reads the file each time, every read is live. Hotkeys and screen
memory are applied on save (above), and Always listening has its own on and off path
(`AlwaysListening`). The brain's own tunables (budget, step cap, turn timeout) are environment
variables, not settings: see [brain.md](brain.md#run-it).

## Secrets

### App secrets in the Python brain

Connected apps' secrets live in the brain, not the desktop. They live in the data
directory, never in the `apps` table:

| Where                 | Holds                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `app-tokens.json`     | `<id>` (bearer token), `<id>:env:<NAME>` (a literal env value), `<id>:url_query` (secret url parts) |
| `app-oauth/<id>.json` | An app's OAuth client and tokens                                                                    |

`${VAR}` references stay in the row and are filled from the brain's environment at connect. The
rules, the startup migration and the missing-key error are in [connected apps](connected-apps.md).
Text saved to disk (chat, approvals, job results, logs) has these values, and key shapes, replaced
by `[secret]`; see [privacy](privacy.md#what-is-masked-on-disk-what-is-not).

### Secrets on the way out

`hideSecrets(text)` (`bodies/desktop/src/main/hide-secrets.ts`) replaces each match with
`[hidden: <kind>]`:

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

It runs over every line of `logs/tagalong.log` (`bodies/desktop/src/main/log-file.ts`). The brain
has its own masking for what it saves (see [privacy](privacy.md#what-is-masked-on-disk-what-is-not)).

## Interfaces

### Desktop IPC

| Channel                                                        | Handler                                   |
| -------------------------------------------------------------- | ----------------------------------------- |
| `IPC.hostView`                                                 | Settings, the local Scout, hotkey problem |
| `IPC.saveSettings`                                             | Validates, stores and fans out the patch  |
| `IPC.settingsChangedEvent` (`tagalong:settings-changed-event`) | Main to windows, after every save         |

## Constants and limits

| Constant                              | Value           | File                                        |
| ------------------------------------- | --------------- | ------------------------------------------- |
| `MIN_VOICE_SPEED` / `MAX_VOICE_SPEED` | 0.7 / 1.3       | `bodies/desktop/src/shared/settings.ts`     |
| `SETTINGS_FILENAME`                   | `settings.json` | `bodies/desktop/src/main/settings-store.ts` |

## Storage

`settings.json` (with `.tmp`, `.bak`, `.corrupt`) sits in the desktop's data
directory, `%APPDATA%\Tagalong` on Windows. The brain keeps its own data directory (see
[brain.md](brain.md#run-it)).

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
- **A bad patch** throws before anything is written. The Settings form checks its own fields first
  and marks a refused one (`SettingsFieldError`,
  `bodies/desktop/src/renderer/src/settings-form.ts`).

## Privacy notes

The settings file holds no secrets, and `hideSecrets` keeps them out of the log. See
[privacy.md](privacy.md).

## Tests that pin it

| Test file                                        | Pins                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `bodies/desktop/src/shared/settings.test.ts`     | Defaults, bounds, unknown fields dropped, patch never invents values                    |
| `bodies/desktop/src/main/settings-store.test.ts` | Missing file, `.bak` fallback, `.corrupt`, atomic save, merge, bad patch writes nothing |
| `bodies/desktop/src/main/ipc/settings.test.ts`   | Host view, save fan-out (hotkeys, broadcast)                                            |
| `bodies/desktop/src/main/hide-secrets.test.ts`   | Each `hideSecrets` rule, ordinary text untouched                                        |
