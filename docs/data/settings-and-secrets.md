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

| Setting             | Default                                                                                                                                              | Bounds and notes                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hotkeys`           | `ask` `CommandOrControl+Shift+Space`, `pauseSight` `CommandOrControl+Shift+Alt+P`, `stopVoice` `CommandOrControl+Shift+Alt+M`, `talk` `RightControl` | `pauseSight`, `stopVoice`, `talk` optional; `talk` is one of `TALK_KEYS` (`RightControl`, `RightAlt`, `RightShift`, `ScrollLock`)                                                                                                     |
| `avatar`            | `{ x: null, y: null }`                                                                                                                               | null docks to the default edge                                                                                                                                                                                                        |
| `captureExclusions` | `{ processNames: [], titlePatterns: [] }`                                                                                                            | Trimmed, non-blank entries; built-in blind spots are separate (`BLIND_SPOTS`)                                                                                                                                                         |
| `voice`             | `{ enabled: true, speed: 0.95 }`                                                                                                                     | speed 0.7 to 1.3 (an old file's `voice` id is ignored); optional `microphoneId`, `mouth` (`MOUTH_IDS`), `ears` (`EARS_IDS`)                                                                                                           |
| `listening`         | `{ always: false }`                                                                                                                                  |                                                                                                                                                                                                                                       |
| `bodyId`            | absent; made on first read                                                                                                                           | This install's body id (`desktop-` and six hex digits), made once and kept. Written only by the desktop's main process (`SettingsStore.setBodyId`), never by a settings patch; a saved id that breaks `^[a-z0-9-]{1,32}$` is replaced |
| `fileFolders`       | `[]`                                                                                                                                                 | Full folder paths (drive, UNC or `/`), trimmed; empty means Scout's file tools refuse. Added with the Settings picker, removed at once                                                                                                |

Those six are the whole schema. The schema has no secret fields.

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
variables, not settings: see [brain.md](../brain/README.md#run-it).

## Environment variables

The brain reads these from the real environment first, then fills any it lacks from
`<TAGALONG_HOME>/.env` (`load_env_file`; an empty variable counts as unset). `.env.example` at the
repo root lists the same names. A bad value stops the brain at start with one line naming the
variable. "Positive" means at least 1.

| Variable                                                         | Default                   | Read by                         | Meaning                                                                             |
| ---------------------------------------------------------------- | ------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                              | none (Scout stays silent) | brain                           | Scout's key; the app saves it in `.env`; a real environment value wins              |
| `TAGALONG_HOME`                                                  | `~/.tagalong`             | brain, desktop (`launch.ts`)    | The data folder; only the real environment can set it, since `.env` lives inside it |
| `TAGALONG_BRAIN_ADDR`                                            | `127.0.0.1:47321`         | brain, desktop, WhatsApp bridge | Where the brain listens and where bodies dial                                       |
| `TAGALONG_MODEL`                                                 | `claude-opus-5-5`         | brain                           | Scout's model until Home saves a choice                                             |
| `TAGALONG_STT_LIVE`                                              | auto                      | brain                           | Live speech model id, or auto, until Home saves a choice                            |
| `TAGALONG_STT_FINAL`                                             | auto                      | brain                           | Final speech model id, auto or `off`, until Home saves a choice                     |
| `TAGALONG_DAILY_BUDGET_USD`                                      | `5.0`                     | brain                           | Daily spend cap in dollars (positive); Home's Daily limit writes it to `.env`       |
| `TAGALONG_STEP_CAP`                                              | `25`                      | brain                           | Most steps in one turn                                                              |
| `TAGALONG_TURN_TIMEOUT_S`                                        | `300`                     | brain                           | Seconds one turn may run                                                            |
| `TAGALONG_LOOP_LAG_MS`                                           | `200`                     | brain                           | Event-loop block longer than this is logged                                         |
| `TAGALONG_READER_MODEL`                                          | `claude-haiku-5-5`        | brain                           | Model that reads mail for loops                                                     |
| `TAGALONG_READER_DAILY_USD`                                      | `0.5`                     | brain                           | The mail reader's own daily cap                                                     |
| `TAGALONG_LOOP_POLL_S`                                           | `300`                     | brain                           | Seconds between mail reads                                                          |
| `TAGALONG_LOOP_STALE_DAYS`                                       | `7`                       | brain                           | Days before a held loop goes to one stale wake                                      |
| `TAGALONG_WORK_KEEP_DAYS`                                        | `30`                      | brain                           | Days finished work is kept before the sweep                                         |
| `TAGALONG_OUTPUTS_KEEP`                                          | `200`                     | brain                           | Stored long tool results kept for `read_output`                                     |
| `TAGALONG_RETRY_MAX`                                             | `3`                       | brain                           | Tries of a step that failed for a passing reason                                    |
| `TAGALONG_RETRY_BACKOFF_S`                                       | `30,120,600`              | brain                           | Waits before each retry; the last repeats                                           |
| `TAGALONG_EXPERT_CMD`                                            | none                      | brain                           | Command of one custom expert (an ACP agent)                                         |
| `TAGALONG_JOB_QUIET_MIN`                                         | `20`                      | brain                           | Minutes a job may show no step before Scout is woken                                |
| `TAGALONG_EXPERT_IDLE_S`                                         | `300`                     | brain                           | Seconds an expert adapter stays warm; `0` stops it at once                          |
| `TAGALONG_WAKES_PER_HOUR`                                        | `12`                      | brain                           | Most times Scout may speak first in an hour                                         |
| `TAGALONG_QUIET_HOURS`                                           | none                      | brain                           | `HH:MM-HH:MM` local; news is held in between, and may wrap midnight                 |
| `TAGALONG_OFFER_MIN_APPROVALS`                                   | `3`                       | brain                           | Approvals of one kind before Scout offers a preference                              |
| `TAGALONG_OFFER_WINDOW_DAYS`                                     | `14`                      | brain                           | Days those approvals are counted over                                               |
| `TAGALONG_KEEP_ASKING_DAYS`                                      | `7`                       | brain                           | Days Scout keeps asking after "not now" on an offer                                 |
| `TAGALONG_TOOL_PREVIEW_CHARS`                                    | `4000`                    | brain                           | Characters of one tool result Scout sees at once                                    |
| `TAGALONG_JOB_STEPS_MAX_ENTRIES`                                 | `2000`                    | brain                           | Steps one job's log keeps                                                           |
| `TAGALONG_JOB_STEPS_MAX_BYTES`                                   | `1000000`                 | brain                           | Text bytes one job's log keeps                                                      |
| `TAGALONG_BUILD`                                                 | none (a source hash)      | brain                           | Build id sent in `hello`; the packaged desktop sets it to the app version           |
| `TAGALONG_STARTED_BY`                                            | `person`                  | brain                           | `desktop` when the desktop started the brain, so it may restart it                  |
| `TAGALONG_START_BRAIN`                                           | on                        | desktop                         | `0` stops the desktop from starting a local brain                                   |
| `TAGALONG_FAKE_MIC`                                              | off                       | desktop                         | `1` points Chromium at a fake microphone (the e2e suites)                           |
| `TAGALONG_WHATSAPP_ENABLED`                                      | off                       | brain                           | `1`, `true` or `yes` starts the WhatsApp bridge                                     |
| `TAGALONG_WHATSAPP_ACCESS_TOKEN`, `_APP_SECRET`, `_VERIFY_TOKEN` | none                      | brain, passed to the bridge     | Secrets, masked in logs and saved text                                              |
| `TAGALONG_WHATSAPP_PHONE_NUMBER_ID`, `_ALLOWED_NUMBER`           | none                      | brain, passed to the bridge     | The person's own numbers, not masked                                                |
| `TAGALONG_WHATSAPP_PORT`                                         | `47322`                   | brain, bridge                   | The bridge's webhook port on 127.0.0.1                                              |

The packaged desktop also sets uv's own variables for the brain (`UV_PROJECT_ENVIRONMENT`,
`UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR`, `UV_PYTHON_PREFERENCE`) under `TAGALONG_HOME`; they are not
settings. An expert's process has `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` stripped
(`setup/env.py`), because experts run on the person's own login.

## Settings precedence

A value can come from three places. Choices made in Home live in the brain's `settings` table
(`tagalong.db`); the process environment and `.env` are the defaults beneath them.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ffffff", "primaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#808080", "arrowheadColor": "#808080", "secondaryColor": "#f2f2f2", "tertiaryColor": "#ffffff", "clusterBkg": "#f7f7f7", "clusterBorder": "#808080", "edgeLabelBackground": "#ffffff", "titleColor": "#808080", "actorBkg": "#ffffff", "actorBorder": "#000000", "actorTextColor": "#000000", "actorLineColor": "#808080", "signalColor": "#808080", "signalTextColor": "#808080", "sequenceNumberColor": "#ffffff", "labelBoxBkgColor": "#ffffff", "labelBoxBorderColor": "#808080", "labelTextColor": "#000000", "loopTextColor": "#808080", "noteBkgColor": "#f7f7f7", "noteBorderColor": "#808080", "noteTextColor": "#000000", "activationBkgColor": "#f7f7f7", "activationBorderColor": "#808080", "fontFamily": "Segoe UI, Helvetica, Arial, sans-serif"}, "themeCSS": ".relationshipLabelBox{opacity:1} .relationshipLabelBox rect{opacity:1}"}}%%
flowchart TD
  Q["Scout's model, speech models, speaking voice"] --> A{"Saved from Home in the<br/>settings table? (model, stt_live,<br/>stt_final, tts_voice)"}
  A -->|yes| R1["use the saved choice"]
  A -->|no| B{"TAGALONG_MODEL or TAGALONG_STT_*<br/>set and valid? (a voice has none)"}
  B -->|yes| R2["use the variable"]
  B -->|no| R3["built-in default: claude-opus-5-5, Auto"]
  E["Every other TAGALONG_* value and the API key"] --> C{"In the real process environment?"}
  C -->|yes| R4["use it (wins)"]
  C -->|no| D{"In TAGALONG_HOME/.env?"}
  D -->|yes| R5["use the .env line"]
  D -->|no| R6["built-in default in config.py"]
```

The real environment always beats `.env` (`load_env_file` only fills what is missing). Home's saved
model and voice choices beat both (`models.chosen`, `stt_choice.chosen_live` and `chosen_final`,
`tts_choice`; a stale or unknown saved id falls back as if unset). Home writes the API key and the
Daily limit to `.env`, so a real environment variable of the same name still wins on the next start.
The desktop's own `settings.json` is separate and never read by the brain.

## Secrets

### App secrets in the Python brain

Connected apps' secrets live in the brain, not the desktop. They live in the data
directory, never in the `apps` table:

| Where                 | Holds                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `app-tokens.json`     | `<id>` (bearer token), `<id>:env:<NAME>` (a literal env value), `<id>:url_query` (secret url parts) |
| `app-oauth/<id>.json` | An app's OAuth client and tokens                                                                    |

`${VAR}` references stay in the row and are filled from the brain's environment at connect. The
rules and the missing-key error are in [connected apps](../bodies/connected-apps.md).
Text saved to disk (chat, approvals, job results, logs) has these values, and key shapes, replaced
by `[secret]`; see [privacy](privacy.md#what-is-masked-on-disk-what-is-not).

### WhatsApp values in the Python brain

The seven `TAGALONG_WHATSAPP_*` variables (enabled, access token, app secret, verify token, phone
number id, allowed number, port) are read from the brain's environment or `<TAGALONG_HOME>/.env`
and listed in `.env.example`. The brain builds the WhatsApp bridge's environment from them and
nothing else. Only the access token, app secret and verify token are masked (in logs,
including the bridge's own output, and in saved text); the numbers are the person's own and are
not. See
[the brain](../brain/README.md#whatsapp-bridge).

Home sets them: Connections > Bodies sends each value once to the Home tool `whatsapp_set`, which writes it to `<TAGALONG_HOME>/.env`. It is never returned (`whatsapp_status` says only which values are set), kept in the renderer after Save, or put in an IPC error. See [WhatsApp](../bodies/whatsapp.md).

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
[brain.md](../brain/README.md#run-it)). Every store of the brain is mapped in [storage.md](storage.md).

Tool permissions (Off, Ask or Auto per tool, shown in Home → Settings → Permissions) are not settings
here: they are brain state in the `rules` table of `tagalong.db`, read and set through the
brain's `list_permissions` and `set_permission` (see [brain.md](../brain/README.md#permissions-and-asks)).
Home shows them in groups the brain names, collapsed until opened, in plain words, with a search box.

**Scout's model** (Settings, right after the key) is not in `settings.json`: the brain owns it. The
section reads `model_state` and a pick calls `set_model` (`IPC.modelState`, `IPC.modelSet`, handled in
`src/main/ipc/model.ts`); the brain keeps the choice in its `settings` table, refuses an id it does
not list, and applies it from the next reply. The picker is the shared `ModelField` in
`bodies/ui/src/model/`, saved at once with "Saved." and an inline error if the brain refuses.
`TAGALONG_MODEL` is only the default until a model is chosen.

**Speech to text** (Settings, after Voice) works the same way: the brain owns the two choices
(`stt_live`, `stt_final` in its `settings` table); the card reads `stt_state` and a pick calls
`set_stt` (`IPC.sttState`, `IPC.sttSet`, `src/main/ipc/voice-models.ts`), saved at once.
`TAGALONG_STT_LIVE` and `TAGALONG_STT_FINAL` are only the defaults until a model is picked.
The Voice page's download line reads the brain's `voice_download` and Try again calls `fetch_voice`
(`IPC.voiceDownload`, `IPC.voiceFetch`); nothing about it is saved. The one
desktop setting on the card is `voice.showWordsWhileTalking` in `settings.json` (default true,
saved with the form's Save): off, push-to-talk shows no words until the talk key is let go.

The daily limit is the one guard limit you can change in the app: **Settings → Anthropic key → Daily limit** (the amount and **Set** in one row, with "$1.20 of $5.00 used today" and a meter under it; the meter turns amber at the limit) calls the brain's `set_daily_limit` (a finite amount above 0). Other guard limits are not settings here. The brain's spend guards take `TAGALONG_DAILY_BUDGET_USD`
and `TAGALONG_STEP_CAP`: `config.py` reads and checks them at start, and they are passed in when
`sessions.py` registers the guards (a guard never imports `config`). They live in the brain's
environment or its `.env` (see [brain.md](../brain/README.md#run-it) and
[Guardrails](../brain/README.md#guardrails)). The step log caps of a job (`TAGALONG_JOB_STEPS_MAX_ENTRIES`, `TAGALONG_JOB_STEPS_MAX_BYTES`) are the same kind of setting, passed from `main.py` through `Session` to `Jobs`. The retention settings (`TAGALONG_WORK_KEEP_DAYS`, `TAGALONG_OUTPUTS_KEEP`) are passed the same way to the session, which sweeps at start. The turn timeout is the same kind of setting:
`TAGALONG_TURN_TIMEOUT_S` (default 300 seconds, a positive number) is read by `config.py`, passed
to the session, and ends a Scout turn that runs too long.

The loops mail reader has its own allowance and model, apart from Scout's: `TAGALONG_READER_DAILY_USD`
(default 0.5, a positive number of US dollars a day; a bad value stops the brain at start, like the
daily limit) and `TAGALONG_READER_MODEL` (default `claude-haiku-5-5`). Both are read by `config.py`
from the environment or `.env`; there is no Home control for them yet. See
[Loops](../brain/README.md#loops).

`TAGALONG_LOOP_POLL_S` (default 300) is how many seconds pass between reads of a mail app that is
switched on for loops. A zero, negative or non-numeric value stops the brain at start. The 14-day
first read is fixed in code, not a setting.

`TAGALONG_LOOP_STALE_DAYS` (default 7) is how many days a held loop may go untouched before the
brain marks it stale and hands it to Scout in one batched wake. A zero, negative or non-numeric
value stops the brain at start.

`TAGALONG_RETRY_MAX` (default 3) is how many times a step that failed for a passing reason
(timeout, network, rate limit) and is safe to repeat is retried before it is reported as failed.
`TAGALONG_RETRY_BACKOFF_S` (default `30,120,600`) is the comma-separated wait in seconds before
each retry; the last value repeats. A zero, negative or non-numeric value stops the brain at start.

Setup keeps its own files under the same data folder, never anywhere else: `runtime/node/`
(Tagalong's own Node, downloaded on first need; `runtime/node.part/` and `runtime/node.new/`
exist only while it downloads), `tools/<expert>/` (an installed expert's packages; staged in `tools/<expert>.part/` and swapped
in only on success, so a failed install removes only what it staged), `cache/` (registry lists) and `experts.json` (the installed experts and their
start commands).
`TAGALONG_EXPERT_CMD` (in `.env` or the environment) names one custom expert; it holds a command, never a secret, and each expert's own key variables are stripped from its process (see ../brain/README.md).
None holds a secret. See [brain.md](../brain/README.md#setting-things-up-setup).

`tagalong key set` (the CLI, for a machine with no screen) writes the same `ANTHROPIC_API_KEY`
line into `<TAGALONG_HOME>/.env` that the app does, owner-only; the key comes from a hidden
prompt or standard input, never from an argument (shell history and the process list would keep
it), and is never printed. `tagalong doctor` says only whether a key is set.

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
