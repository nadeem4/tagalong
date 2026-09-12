import { z } from 'zod';

/**
 * Engine settings that cross the wire. Secrets are deliberately absent: they live in
 * the host's SecretStore and never appear in settings.get or on disk in this shape.
 */

/** Default value for every setting, in one place so the patch schema can stay defaults-free. */
export const SETTINGS_DEFAULTS = {
  enginePort: 47321,
  defaultPetId: 'scout',
  providerId: 'anthropic',
  defaultModel: 'claude-opus-5',
  pageTextBudget: 40_000,
  historyMessages: 20,
  hotkeys: { ask: 'CommandOrControl+Shift+Space' },
  avatar: { x: null, y: null },
} as const;

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
  hotkeys: z.object({ ask: z.string().min(1) }),
  /** Remembered avatar position; null means "dock to the default edge". */
  avatar: z.object({ x: z.number().nullable(), y: z.number().nullable() }),
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
});
export type Settings = z.infer<typeof Settings>;

/**
 * settings.set accepts a partial patch; everything omitted keeps its current value.
 * Built from the defaults-free validators so parsing a patch never invents values.
 */
export const SettingsPatch = z.object(settingsFields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;
