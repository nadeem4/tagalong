import { z } from 'zod';

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

/** Default value for every setting, in one place so the patch schema can stay defaults-free. */
export const SETTINGS_DEFAULTS = {
  enginePort: 47321,
  defaultPetId: 'scout',
  providerId: 'anthropic',
  defaultModel: 'claude-opus-5',
  pageTextBudget: 40_000,
  historyMessages: 20,
  hotkeys: { ask: 'CommandOrControl+Shift+Space', look: 'CommandOrControl+Shift+S' },
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
  captureExclusions: {
    processNames: [
      '1Password.exe',
      'Bitwarden.exe',
      'KeePass.exe',
      'KeePassXC.exe',
      'LastPass.exe',
      'CredentialUIBroker.exe',
      'LogonUI.exe',
      'consent.exe',
    ],
    titlePatterns: ['*1Password*', '*Bitwarden*', '*KeePass*', '*LastPass*', '*Windows Security*'],
  },
  /**
   * Off by default. A screenshot is the most sensitive thing this app ever touches — it
   * can hold a bank balance, a private message or a token that happened to be on screen —
   * and the plan says screenshots are not persisted. Retention is therefore opt-in, for
   * debugging, and bounded.
   */
  screenshotRetention: { mode: 'off' },
} as const;

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
  /** BrainProvider id: 'anthropic' or 'fake' in Phase 1. */
  providerId: z.string().min(1),
  defaultModel: z.string().min(1),
  /** Character budget for page text in an assembled prompt. */
  pageTextBudget: z.number().int().positive(),
  /** How many past messages are replayed to the model. */
  historyMessages: z.number().int().positive(),
  /**
   * `look` is optional so a settings file written before the looking hotkey existed still
   * parses — and because a patch replaces the whole `hotkeys` object, so a caller that only
   * rebinds `ask` must not be forced to resend a key it never touched. The host falls back
   * to its own default when it is absent.
   */
  hotkeys: z.object({ ask: z.string().min(1), look: z.string().min(1).optional() }),
  /** Remembered avatar position; null means "dock to the default edge". */
  avatar: z.object({ x: z.number().nullable(), y: z.number().nullable() }),
  /** Windows where capture is refused outright. */
  captureExclusions: CaptureExclusions,
  /** Whether a captured screenshot may be stored, and for how long. */
  screenshotRetention: ScreenshotRetention,
};

export const Settings = z.object({
  enginePort: settingsFields.enginePort.default(SETTINGS_DEFAULTS.enginePort),
  defaultPetId: settingsFields.defaultPetId.default(SETTINGS_DEFAULTS.defaultPetId),
  providerId: settingsFields.providerId.default(SETTINGS_DEFAULTS.providerId),
  defaultModel: settingsFields.defaultModel.default(SETTINGS_DEFAULTS.defaultModel),
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
});
export type Settings = z.infer<typeof Settings>;

/**
 * settings.set accepts a partial patch; everything omitted keeps its current value.
 * Built from the defaults-free validators so parsing a patch never invents values.
 */
export const SettingsPatch = z.object(settingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;
