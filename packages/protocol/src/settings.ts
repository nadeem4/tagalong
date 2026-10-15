import { z } from 'zod';

import { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './limits';
import { EARS_IDS, MOUTH_IDS } from './voice';

/**
 * Engine settings that cross the wire. Secrets are deliberately absent: they live in
 * the host's SecretStore and never appear in settings.get or on disk in this shape.
 */

/**
 * Ceiling on screenshot retention. The plan offers exactly one debugging window — 24
 * hours — so anything longer is a typo or a misunderstanding, not a supported choice.
 * Bounding it here means no host has to invent its own limit later.
 */
export const MAX_SCREENSHOT_RETENTION_HOURS = 24;

/**
 * Ceiling on rolling memory. Thirty minutes of 640-pixel frames of two displays is already
 * tens of megabytes of the user's screen in memory; the phase plan's default is ten.
 */
export const MAX_ROLLING_MEMORY_MINUTES = 30;

/** Ceiling on the name Scout calls the person: a first name, not a paragraph. */
export const MAX_USER_NAME_CHARS = 40;

/** The guided first run, in order. `answer` is offered only when setup can listen. */
export const WELCOME_STEPS = ['answer', 'name', 'think', 'voice', 'keys', 'try'] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

/** Default value for every setting, in one place so the patch schema can stay defaults-free. */
export const SETTINGS_DEFAULTS = {
  enginePort: 47321,
  defaultPetId: 'scout',
  /** Every OpenAI-compatible preset on its own base URL until the user says otherwise. */
  providerBaseUrls: {} as Record<string, string>,
  pageTextBudget: 40_000,
  historyMessages: 20,
  hotkeys: {
    ask: 'CommandOrControl+Shift+Space',
    pauseSight: 'CommandOrControl+Shift+Alt+P',
    stopVoice: 'CommandOrControl+Shift+Alt+M',
    talk: 'CommandOrControl+Shift+Alt+Space',
  },
  avatar: { x: null, y: null },
  /**
   * Why this set: every entry is a window where the pixels on screen are a credential.
   * The four desktop password managers below cover the overwhelming majority of Windows
   * installs; `CredentialUIBroker.exe` is the "Windows Security" prompt that asks for a
   * PIN, a password or a passkey, and `LogonUI.exe` is the lock screen. `consent.exe`
   * (UAC) is listed for completeness even though it runs on the secure desktop and is
   * usually uncapturable anyway — cheap insurance if that ever stops being true.
   *
   * The title patterns exist because the same secrets are reached through a browser: the
   * process is then `chrome.exe` or `msedge.exe`, which we must never block wholesale.
   * They are deliberately few — a broad pattern like `*password*` would block an
   * ordinary docs page about passwords and teach the user to switch the feature off.
   */
  /**
   * The person's own additions. Empty: password managers, secret files and the rest are
   * `BLIND_SPOTS`, built in, so clearing this list never takes them away.
   */
  captureExclusions: { processNames: [] as string[], titlePatterns: [] as string[] },
  /**
   * Off by default. A screenshot is the most sensitive thing this app ever touches — it
   * can hold a bank balance, a private message or a token that happened to be on screen —
   * and the plan says screenshots are not persisted. Retention is therefore opt-in, for
   * debugging, and bounded.
   */
  screenshotRetention: { mode: 'off' },
  /**
   * How much of a full-view capture is attached as pictures.
   *
   * `focused` sends the composite and the display the user is working on; the rest are
   * named in the context text and fetched by tool if the pet wants one. `all` sends every
   * display as an image.
   *
   * The default is the cheap one because the expensive one scales with hardware: `all` on
   * a three-monitor desk multiplies the image bill by three on every ask that carries a
   * look, and the person who bought the third monitor is not the person who chose that.
   */
  sightDetail: 'focused',
  /**
   * How much text one `read_window_text` returns when the pet does not say.
   *
   * A cost control, not a quality one. Eight thousand characters is roughly 2,000 tokens;
   * raising it to the ceiling makes a single window read cost as much as five do now, on
   * every read, because the pet almost never names a smaller number itself.
   */
  windowTextBudget: DEFAULT_WINDOW_TEXT_CHARS,
  summarizer: null,
  hiddenPets: [] as string[],
  /**
   * Phase 3B. Off by default: remembering the screen is the most a pet ever holds about
   * the user, and it is the user's call to start it. Ten minutes when they do.
   */
  rollingMemory: { enabled: false, minutes: 10 },
  /** Phase 3B. The phase plan's caps: 60 model checks a watch, 3 watches at once. */
  watch: { maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 },
  /**
   * Phase 7. Whether the first-run setup wizard has been finished or skipped. A settings
   * file from before the wizard reads as not done, so an existing install sees it once.
   */
  onboarding: { done: false },
  /**
   * Whether the Welcome window has been finished. It replaced the setup wizard, so an
   * install that finished the wizard still sees Welcome once.
   */
  welcome: { done: false },
  /**
   * Whether Scout says one short line when Tagalong opens, after the first time. On by
   * default; the line reads no screen, only the time and the hand-offs that finished.
   */
  greeting: true,
  /** When Tagalong last launched: the greeting names the hand-offs finished since. */
  lastOpenedAt: null,
  /** When Tagalong was last quit, so the greeting can say how long you were away. */
  lastClosedAt: null,
  /**
   * Whether the last launch closed cleanly. Main sets it false as each launch starts and
   * true on a clean quit, so false at the next start means the last one crashed. True for a
   * settings file from before it, so an upgrade is never read as a crash.
   */
  closedCleanly: true,
  /** The app version the last launch ran, so the greeting can say Tagalong was updated. */
  lastVersion: null,
  /**
   * Whether Scout keeps an eye on things: it follows window titles (never pixels) and,
   * rarely, reads one window and says one short line. On by default; off means no
   * tracking at all.
   */
  keepAnEye: true,
  /**
   * Scout reads its bubble aloud, because the person may not be looking at the screen.
   * On by default, in a calm British voice slightly slower than normal. The ElevenLabs
   * voice id is empty until the person picks one from their own library: with a key and
   * an id, ElevenLabs speaks instead of the local voice.
   */
  voice: { enabled: true, voice: 'bm_george', speed: 0.95, elevenLabsVoiceId: '' },
  /**
   * What Scout calls the person. Empty until they say: Scout then uses no name. Stored
   * here, on this computer; it reaches the AI provider only inside Scout's prompt.
   */
  userName: '',
  /** "Rather not" in setup: Scout never asks for a name again. */
  userNameDeclined: false,
  /**
   * Whether Scout listens all the time. Off by default: only the person switches it on,
   * and it stays on across restarts until they switch it off. Scout never switches it on.
   */
  listening: { always: false },
  /**
   * Pick up where you left off: one snapshot of what you were in the middle of, from window
   * titles, offered once when you are back after six hours. On by default; it opens nothing
   * without a click. Off means no snapshot at all, and switching it off deletes the one kept.
   */
  pickUp: true,
} as const;

/** The local voices Scout can speak in: two British male voices of the Kokoro model. */
export const VOICE_IDS = ['bm_george', 'bm_fable'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

/** Bounds on the speaking speed. Outside them speech stops sounding like speech. */
export const MIN_VOICE_SPEED = 0.7;
export const MAX_VOICE_SPEED = 1.3;

/** A non-blank, trimmed entry. A blank one would match every window and blind the pet. */
const exclusionEntry = z.string().trim().min(1);

/**
 * Windows a capture must refuse.
 *
 * Two rules rather than one because the same secret is reached two ways: a native app has
 * a stable process name, while a web vault only shows up in the title of a browser window
 * we must not block by process.
 *
 * `titlePatterns` are globs (`*` only), not regular expressions. A user-supplied regex
 * would be run against every active window on every capture, so one pathological pattern
 * could hang capture — and nobody debugging "why can't my pet see" wants to discover they
 * wrote a catastrophic backtrack. Globs also read the way people expect a blocklist to.
 */
export const CaptureExclusions = z.object({
  /** Matched case-insensitively against the whole process name, never by substring. */
  processNames: z.array(exclusionEntry),
  /** Anchored, case-insensitive globs over the window title; `*` is the only wildcard. */
  titlePatterns: z.array(exclusionEntry),
});
export type CaptureExclusions = z.infer<typeof CaptureExclusions>;

/**
 * Which configured entry refused a capture.
 *
 * Carries the matching rule rather than a bare boolean so the UI can say "1Password.exe is
 * on your exclusion list" instead of "blocked", and so a user who did not expect a refusal
 * can find the line that caused it. It lives in the protocol because it now crosses the
 * socket: a full-view capture refuses one display or one window while returning the rest,
 * so the reason has to travel with the snapshot.
 */
export const CaptureBlock = z.object({
  rule: z.enum(['processName', 'titlePattern']),
  /** The exclusion entry exactly as the user wrote it, for display. */
  entry: z.string().min(1),
});
export type CaptureBlock = z.infer<typeof CaptureBlock>;

/**
 * How long a captured screenshot may live in the database.
 *
 * A tagged union rather than a number, so "never persist" is a state of its own instead of
 * a zero that every reader has to remember the meaning of.
 */
export const ScreenshotRetention = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('off') }),
  z.object({
    mode: z.literal('hours'),
    hours: z.number().int().min(1).max(MAX_SCREENSHOT_RETENTION_HOURS),
  }),
]);
export type ScreenshotRetention = z.infer<typeof ScreenshotRetention>;

/**
 * Field validators without defaults attached.
 *
 * `.partial()` makes a field optional but does not strip its `.default()`, so a patch
 * built from a defaulted schema would quietly reset every field the caller left out.
 * Keeping the validators separate from the defaults is what makes settings.set safe.
 */
const settingsFields = {
  /** Loopback port for the host websocket. */
  enginePort: z.number().int().min(1024).max(65535),
  /** Pet used when a host asks without naming one. */
  defaultPetId: z.string().min(1),
  /**
   * Base URL overrides for the OpenAI-compatible presets, keyed by provider id
   * (`nebius`, `openrouter`). An absent entry means the preset's own URL. This is what
   * makes "any OpenAI-format service" a settings change: a URL here, a key in the
   * keychain, a model id on the pet.
   */
  providerBaseUrls: z.record(z.string().min(1), z.url()),
  /** Character budget for page text in an assembled prompt. */
  pageTextBudget: z.number().int().positive(),
  /** How many past messages are replayed to the model. */
  historyMessages: z.number().int().positive(),
  /**
   * Two keys: the ask, and the pause. The look and see-everything keys of older settings
   * files are dropped on parse: Scout takes screenshots and reads other windows itself now.
   */
  hotkeys: z.object({
    ask: z.string().min(1),
    /**
     * Turns all sight off and on again. Optional so a settings file written before it still
     * parses, and because a patch replaces the whole `hotkeys` object, so a caller that only
     * rebinds `ask` must not be forced to resend it. The host falls back to its default.
     *
     * The tray carries the same action, so a settings file that never names this key, or
     * an accelerator another application already owns, still leaves the user a way to
     * blind the pet.
     */
    pauseSight: z.string().min(1).optional(),
    /** Stops Scout speaking at once. Optional for the same reasons as `pauseSight`. */
    stopVoice: z.string().min(1).optional(),
    /**
     * Talk to Scout: held down, the microphone listens; let go, Scout hears the question.
     * Optional for the same reasons as `pauseSight`.
     */
    talk: z.string().min(1).optional(),
  }),
  /** Remembered avatar position; null means "dock to the default edge". */
  avatar: z.object({ x: z.number().nullable(), y: z.number().nullable() }),
  /** Windows where capture is refused outright. */
  captureExclusions: CaptureExclusions,
  /** Whether a captured screenshot may be stored, and for how long. */
  screenshotRetention: ScreenshotRetention,
  /** Whether a full-view capture attaches every display or only the focused one. */
  sightDetail: z.enum(['focused', 'all']),
  /**
   * Default character cap for one window text read.
   *
   * Bounded at both ends on purpose: zero would make the text layer silently useless and
   * read as a broken feature, and the ceiling is the page-text cap, past which one window
   * can outweigh everything else in the prompt.
   */
  windowTextBudget: z.number().int().positive().max(MAX_WINDOW_TEXT_CHARS),
  /**
   * Phase 4. The brain that writes conversation summaries. Null means each pet summarises
   * its own conversations with its own provider and model, so a crew on Token Factory and
   * OpenRouter never needs a third key just for housekeeping.
   */
  summarizer: z.object({ providerId: z.string().min(1), model: z.string().min(1) }).nullable(),
  /** Phase 4. Pets left off the desktop crew strip. They still answer in the panel. */
  hiddenPets: z.array(z.string().min(1)),
  /** Phase 3B. Whether the desktop keeps its last few minutes in memory, and how many. */
  rollingMemory: z.object({
    enabled: z.boolean(),
    minutes: z.number().int().min(1).max(MAX_ROLLING_MEMORY_MINUTES),
  }),
  /**
   * Phase 3B. What one watch may spend. `maxChecks` bounds the model calls a watch makes,
   * `maxConcurrent` how many run at once, and `defaultTimeoutMinutes` how long a watch
   * runs when the pet names no timeout of its own.
   */
  watch: z.object({
    maxChecks: z.number().int().min(1).max(500),
    maxConcurrent: z.number().int().min(1).max(10),
    defaultTimeoutMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  }),
  /** Phase 7. Set when the setup wizard is finished or skipped; Settings can rerun it. */
  onboarding: z.object({ done: z.boolean() }),
  /**
   * The guided first run: whether it is finished, the furthest step reached (where it
   * resumes), how the person answers, and the brain picked. A patch replaces the whole
   * object, so every writer spreads the current one first.
   */
  welcome: z.object({
    done: z.boolean(),
    step: z.enum(WELCOME_STEPS).optional(),
    answerBy: z.enum(['talk', 'type']).optional(),
    brain: z.string().min(1).optional(),
  }),
  /** Whether Scout greets you on a launch after the first; Welcome's intro shows regardless. */
  greeting: z.boolean(),
  /** When Tagalong last opened; null before the first launch that recorded it. */
  lastOpenedAt: z.iso.datetime().nullable(),
  /** When Tagalong was last quit; null before the first quit that recorded it. */
  lastClosedAt: z.iso.datetime().nullable(),
  /** False while a launch is running; still false at the next start after a crash. */
  closedCleanly: z.boolean(),
  /** The version the last launch ran; null before the first launch that recorded it. */
  lastVersion: z.string().min(1).nullable(),
  /** Whether Scout follows window titles and now and then says one useful line. */
  keepAnEye: z.boolean(),
  /** Whether Scout speaks its bubble, in which voice and how fast. */
  voice: z.object({
    enabled: z.boolean(),
    voice: z.enum(VOICE_IDS),
    speed: z.number().min(MIN_VOICE_SPEED).max(MAX_VOICE_SPEED),
    /** A voice from the person's ElevenLabs library. Empty: ElevenLabs is not used. */
    elevenLabsVoiceId: z.string().trim(),
    /** The microphone Talk to Scout listens on. Absent: the system default microphone. */
    microphoneId: z.string().optional(),
    /**
     * Who says Scout's lines. Absent in a file from before the picker: `chosenMouth`
     * decides (ElevenLabs when a voice ID is set, otherwise Kokoro).
     */
    mouth: z.enum(MOUTH_IDS).optional(),
    /** Who listens. Absent: the local ears, the only ones today. */
    ears: z.enum(EARS_IDS).optional(),
  }),
  /** What Scout calls the person; empty for no name. */
  userName: z.string().trim().max(MAX_USER_NAME_CHARS),
  /** Set by "Rather not": the name is never asked for again. */
  userNameDeclined: z.boolean(),
  /** Whether Scout listens all the time, hearing only turns that start with its name. */
  listening: z.object({ always: z.boolean() }),
  /** Whether Scout keeps a snapshot of what you were in the middle of, to offer when you are back. */
  pickUp: z.boolean(),
};

export const Settings = z.object({
  enginePort: settingsFields.enginePort.default(SETTINGS_DEFAULTS.enginePort),
  defaultPetId: settingsFields.defaultPetId.default(SETTINGS_DEFAULTS.defaultPetId),
  providerBaseUrls: settingsFields.providerBaseUrls.prefault({
    ...SETTINGS_DEFAULTS.providerBaseUrls,
  }),
  pageTextBudget: settingsFields.pageTextBudget.default(SETTINGS_DEFAULTS.pageTextBudget),
  historyMessages: settingsFields.historyMessages.default(SETTINGS_DEFAULTS.historyMessages),
  hotkeys: settingsFields.hotkeys.prefault({ ...SETTINGS_DEFAULTS.hotkeys }),
  avatar: settingsFields.avatar.prefault({ ...SETTINGS_DEFAULTS.avatar }),
  captureExclusions: settingsFields.captureExclusions.prefault({
    processNames: [...SETTINGS_DEFAULTS.captureExclusions.processNames],
    titlePatterns: [...SETTINGS_DEFAULTS.captureExclusions.titlePatterns],
  }),
  screenshotRetention: settingsFields.screenshotRetention.prefault({
    ...SETTINGS_DEFAULTS.screenshotRetention,
  }),
  sightDetail: settingsFields.sightDetail.default(SETTINGS_DEFAULTS.sightDetail),
  windowTextBudget: settingsFields.windowTextBudget.default(SETTINGS_DEFAULTS.windowTextBudget),
  summarizer: settingsFields.summarizer.default(SETTINGS_DEFAULTS.summarizer),
  hiddenPets: settingsFields.hiddenPets.prefault([...SETTINGS_DEFAULTS.hiddenPets]),
  rollingMemory: settingsFields.rollingMemory.prefault({ ...SETTINGS_DEFAULTS.rollingMemory }),
  watch: settingsFields.watch.prefault({ ...SETTINGS_DEFAULTS.watch }),
  onboarding: settingsFields.onboarding.prefault({ ...SETTINGS_DEFAULTS.onboarding }),
  welcome: settingsFields.welcome.prefault({ ...SETTINGS_DEFAULTS.welcome }),
  greeting: settingsFields.greeting.default(SETTINGS_DEFAULTS.greeting),
  lastOpenedAt: settingsFields.lastOpenedAt.default(SETTINGS_DEFAULTS.lastOpenedAt),
  lastClosedAt: settingsFields.lastClosedAt.default(SETTINGS_DEFAULTS.lastClosedAt),
  closedCleanly: settingsFields.closedCleanly.default(SETTINGS_DEFAULTS.closedCleanly),
  lastVersion: settingsFields.lastVersion.default(SETTINGS_DEFAULTS.lastVersion),
  keepAnEye: settingsFields.keepAnEye.default(SETTINGS_DEFAULTS.keepAnEye),
  voice: settingsFields.voice.prefault({ ...SETTINGS_DEFAULTS.voice }),
  userName: settingsFields.userName.default(SETTINGS_DEFAULTS.userName),
  userNameDeclined: settingsFields.userNameDeclined.default(SETTINGS_DEFAULTS.userNameDeclined),
  listening: settingsFields.listening.prefault({ ...SETTINGS_DEFAULTS.listening }),
  pickUp: settingsFields.pickUp.default(SETTINGS_DEFAULTS.pickUp),
});
export type Settings = z.infer<typeof Settings>;

/**
 * settings.set accepts a partial patch; everything omitted keeps its current value.
 * Built from the defaults-free validators so parsing a patch never invents values.
 */
export const SettingsPatch = z.object(settingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;
