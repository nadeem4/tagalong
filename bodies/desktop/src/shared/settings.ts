/**
 * The desktop's settings: the Settings schema, SETTINGS_DEFAULTS and SettingsPatch for the
 * settings file and `settings.set`. Only fields something reads live here.
 */
import { EARS_IDS, MOUTH_IDS } from '@tagalong/ui/shapes';
import { z } from 'zod';

/**
 * The keys Talk to Scout can be: one key, held alone. Never a combo: the desktop watches this
 * one key go down and up itself, since no global shortcut reports a release.
 */
export const TALK_KEYS = ['RightControl', 'RightAlt', 'RightShift', 'ScrollLock'] as const;
export type TalkKey = (typeof TALK_KEYS)[number];

/** The default talk key: Right Ctrl held alone. */
export const TALK_KEY_RIGHT_CTRL: TalkKey = 'RightControl';

/** Each talk key as a person reads it. */
export const TALK_KEY_LABELS: { readonly [K in TalkKey]: string } = {
  RightControl: 'Right Ctrl',
  RightAlt: 'Right Alt',
  RightShift: 'Right Shift',
  ScrollLock: 'Scroll Lock',
};

/** What the contract allows a body id to be (`hello.body.id`). */
export const BODY_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Default value for every setting, in one place so the patch schema can stay defaults-free. */
export const SETTINGS_DEFAULTS = {
  hotkeys: {
    ask: 'CommandOrControl+Shift+Space',
    pauseSight: 'CommandOrControl+Shift+Alt+P',
    stopVoice: 'CommandOrControl+Shift+Alt+M',
    talk: TALK_KEY_RIGHT_CTRL,
  },
  avatar: { x: null, y: null },
  /**
   * The person's own additions. Empty: password managers, secret files and the rest are
   * `BLIND_SPOTS`, built in, so clearing this list never takes them away.
   */
  captureExclusions: { processNames: [] as string[], titlePatterns: [] as string[] },
  /**
   * Scout reads its bubble aloud, because the person may not be looking at the screen.
   * On by default, slightly slower than normal. Which voice speaks is the brain's choice
   * (`tts_state`), not a desktop setting.
   */
  voice: { enabled: true, speed: 0.95 },
  /**
   * Whether Scout listens all the time. Off by default: only the person switches it on,
   * and it stays on across restarts until they switch it off. Scout never switches it on.
   */
  listening: { always: false },
  /** Whether the first-run walkthrough was finished or skipped. Closing it does not count. */
  walkthrough: { done: false },
  /** The folders Scout's file tools may touch. None until the person names one. */
  fileFolders: [] as string[],
  /** No addresses: the brain on this PC. A paired remote brain is saved by main only. */
  brain: { addrs: [] as string[] },
} as const;

/** Bounds on the speaking speed. Outside them speech stops sounding like speech. */
export const MIN_VOICE_SPEED = 0.7;
export const MAX_VOICE_SPEED = 1.3;

/** A non-blank, trimmed entry. A blank one would match every window and blind the pet. */
const exclusionEntry = z.string().trim().min(1);

/**
 * A folder the person allowed: a non-blank absolute path (drive, UNC share or POSIX root).
 * A relative one would mean a different folder depending on where the app was started.
 */
const folderEntry = z
  .string()
  .trim()
  .regex(/^([a-zA-Z]:[\\/]|\\\\|\/)/, 'must be a full folder path')
  // Device and raw-volume prefixes name devices, not folders a person picks.
  .refine((value) => !/^[\\/]{2}[?.][\\/]/.test(value), 'must be a full folder path');

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
 * Field validators without defaults attached.
 *
 * `.partial()` makes a field optional but does not strip its `.default()`, so a patch
 * built from a defaulted schema would quietly reset every field the caller left out.
 * Keeping the validators separate from the defaults is what makes settings.set safe.
 */
const settingsFields = {
  /** The global shortcuts. Unknown keys are dropped on parse. */
  hotkeys: z.object({
    ask: z.string().min(1),
    /**
     * Turns all sight off and on again. Optional: a patch replaces the whole `hotkeys`
     * object, so a caller that only rebinds `ask` need not resend it; the host falls back to
     * its default. The tray has the same action, so sight can always be paused.
     */
    pauseSight: z.string().min(1).optional(),
    /** Stops Scout speaking at once. Optional for the same reasons as `pauseSight`. */
    stopVoice: z.string().min(1).optional(),
    /**
     * Talk to Scout: held down, the microphone listens; let go, Scout hears the question.
     * One key from TALK_KEYS, never a combo. Optional for the same reasons as `pauseSight`.
     */
    talk: z.enum(TALK_KEYS).optional(),
  }),
  /** Remembered avatar position; null means "dock to the default edge". */
  avatar: z.object({ x: z.number().nullable(), y: z.number().nullable() }),
  /** Windows where capture is refused outright. */
  captureExclusions: CaptureExclusions,
  /** Whether Scout speaks its bubble and how fast. An old file's `voice` id is dropped on parse. */
  voice: z.object({
    enabled: z.boolean(),
    speed: z.number().min(MIN_VOICE_SPEED).max(MAX_VOICE_SPEED),
    /** The microphone Talk to Scout listens on. Absent: the system default microphone. */
    microphoneId: z.string().optional(),
    /** Who says Scout's lines. Absent: Kokoro, the local voice. */
    mouth: z.enum(MOUTH_IDS).optional(),
    /** Who listens. Absent: the local ears. */
    ears: z.enum(EARS_IDS).optional(),
    /**
     * Push-to-talk: show words as they come (the default) or only when the key is let go.
     * Absent means on. Listening always ignores it.
     */
    showWordsWhileTalking: z.boolean().optional(),
  }),
  /** Whether Scout listens all the time, hearing only turns that start with its name. */
  listening: z.object({ always: z.boolean() }),
  /** Set by Finish or Skip (with a key) only. */
  walkthrough: z.object({ done: z.boolean() }),
  /** Folders Scout may list, read and change. Empty means the file tools refuse. */
  fileFolders: z.array(folderEntry),
};

/**
 * This install's body id, made once and kept. Not in `settingsFields`, so no patch (and so no
 * renderer) can rewrite it: only main sets it, through `SettingsStore.setBodyId`. A saved id
 * that breaks the contract's pattern reads as absent (the rest of the file stays), so
 * `readOrMakeBodyId` makes a new one.
 */
const bodyIdField = z.string().regex(BODY_ID_PATTERN).optional().catch(undefined);

/**
 * Which brain this desktop talks to. Like `bodyId`, not in `settingsFields`: only main writes it
 * (`SettingsStore.setBrain`), so a renderer patch cannot point the desktop at another brain.
 * `token` is the device token sealed by the OS (base64), never the token itself.
 */
const brainField = z
  .object({
    addrs: z.array(z.string()),
    lastGood: z.string().optional(),
    fp: z.string().optional(),
    token: z.string().optional(),
  })
  .prefault({ ...SETTINGS_DEFAULTS.brain })
  .catch(() => ({ ...SETTINGS_DEFAULTS.brain }));
export type BrainSettings = z.infer<typeof brainField>;

/** Unknown keys in settings.json are dropped on parse. */
export const Settings = z.object({
  hotkeys: settingsFields.hotkeys.prefault({ ...SETTINGS_DEFAULTS.hotkeys }),
  avatar: settingsFields.avatar.prefault({ ...SETTINGS_DEFAULTS.avatar }),
  captureExclusions: settingsFields.captureExclusions.prefault({
    processNames: [...SETTINGS_DEFAULTS.captureExclusions.processNames],
    titlePatterns: [...SETTINGS_DEFAULTS.captureExclusions.titlePatterns],
  }),
  voice: settingsFields.voice.prefault({ ...SETTINGS_DEFAULTS.voice }),
  listening: settingsFields.listening.prefault({ ...SETTINGS_DEFAULTS.listening }),
  walkthrough: settingsFields.walkthrough.prefault({ ...SETTINGS_DEFAULTS.walkthrough }),
  bodyId: bodyIdField,
  brain: brainField,
  fileFolders: settingsFields.fileFolders.prefault([]),
});
export type Settings = z.infer<typeof Settings>;

/**
 * settings.set accepts a partial patch; everything omitted keeps its current value.
 * Built from the defaults-free validators so parsing a patch never invents values.
 */
export const SettingsPatch = z.object(settingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;
