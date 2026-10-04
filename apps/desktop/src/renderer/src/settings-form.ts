import {
  MAX_ROLLING_MEMORY_MINUTES,
  MAX_WINDOW_TEXT_CHARS,
  SettingsPatch,
} from '@tagalong/protocol';
import type { SettingsPatch as SettingsPatchType } from '@tagalong/protocol';

/**
 * The settings form's raw values, as `FormData` hands them over: every field a string.
 *
 * Separate from the component so the patch it builds can be tested. The desktop package
 * runs its tests in plain Node with no DOM, and the interesting part here was never the
 * rendering — it was which fields end up in the patch.
 */
export interface SettingsFormValues {
  /** One box per OpenAI-compatible preset. Blank means the preset's own URL. */
  baseUrls: readonly { providerId: string; label: string; value: string }[];
  askHotkey: string;
  lookHotkey: string;
  seeEverythingHotkey: string;
  pauseSightHotkey: string;
  sightDetail: string;
  windowTextBudget: string;
  /** Phase 4. The pets unticked under "Show on desktop". Absent leaves the setting alone. */
  hiddenPets?: readonly string[];
  /** Phase 4. Both blank means each pet summarises with its own brain. */
  summarizerProviderId?: string;
  summarizerModel?: string;
  /** Phase 3B. Present together when the form shows the Awareness section. */
  rollingMemoryEnabled?: boolean;
  rollingMemoryMinutes?: string;
  watchMaxChecks?: string;
  watchMaxConcurrent?: string;
  watchTimeoutMinutes?: string;
}

/**
 * Turns the form into a settings patch, or throws something a user can act on.
 *
 * **Every hotkey goes in every time.** A patch replaces the whole `hotkeys` object, so a
 * form that sends only the keys it happens to display silently drops the rest back to
 * their defaults — which is exactly what this form did before the full-view and pause
 * keys were added to it: nothing failed, nothing warned, and a rebound key quietly
 * stopped being the one the user typed.
 *
 * Nothing the form does not show is included, so saving cannot reset the exclusion list
 * or the retention mode as a side effect of changing a base URL. Models are not here at
 * all: each pet carries its own and is saved through `pets.upsert`.
 */
export function buildSettingsPatch(values: SettingsFormValues): SettingsPatchType {
  return SettingsPatch.parse({
    providerBaseUrls: parseBaseUrls(values.baseUrls),
    hotkeys: {
      ask: values.askHotkey.trim(),
      look: values.lookHotkey.trim(),
      seeEverything: values.seeEverythingHotkey.trim(),
      pauseSight: values.pauseSightHotkey.trim(),
    },
    sightDetail: values.sightDetail,
    windowTextBudget: parseBudget(values.windowTextBudget),
    ...(values.hiddenPets !== undefined ? { hiddenPets: [...values.hiddenPets] } : {}),
    ...(values.summarizerProviderId !== undefined || values.summarizerModel !== undefined
      ? { summarizer: parseSummarizer(values.summarizerProviderId, values.summarizerModel) }
      : {}),
    ...(values.rollingMemoryMinutes !== undefined
      ? {
          rollingMemory: {
            enabled: values.rollingMemoryEnabled === true,
            minutes: wholeNumber(
              values.rollingMemoryMinutes,
              1,
              MAX_ROLLING_MEMORY_MINUTES,
              `Rolling memory must keep between 1 and ${MAX_ROLLING_MEMORY_MINUTES} minutes.`,
            ),
          },
        }
      : {}),
    ...(values.watchMaxChecks !== undefined
      ? {
          watch: {
            maxChecks: wholeNumber(
              values.watchMaxChecks,
              1,
              500,
              'Checks per watch must be a whole number between 1 and 500.',
            ),
            maxConcurrent: wholeNumber(
              values.watchMaxConcurrent ?? '',
              1,
              10,
              'Watches at once must be a whole number between 1 and 10.',
            ),
            defaultTimeoutMinutes: wholeNumber(
              values.watchTimeoutMinutes ?? '',
              1,
              24 * 60,
              'The watch timeout must be a whole number of minutes, at least 1.',
            ),
          },
        }
      : {}),
  });
}

/** A whole number in bounds, or the sentence the person needs to fix it. */
function wholeNumber(raw: string, min: number, max: number, problem: string): number {
  const value = Number(raw.trim());
  if (raw.trim().length === 0 || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(problem);
  }
  return value;
}

/** Both boxes or neither: half a summarizer is a typo, not a choice. */
function parseSummarizer(
  rawProvider: string | undefined,
  rawModel: string | undefined,
): { providerId: string; model: string } | null {
  const providerId = (rawProvider ?? '').trim();
  const model = (rawModel ?? '').trim();
  if (providerId.length === 0 && model.length === 0) return null;
  if (providerId.length === 0 || model.length === 0) {
    throw new Error(
      'The summarizer needs both a provider and a model — or leave both blank to use each pet’s own.',
    );
  }
  return { providerId, model };
}

/**
 * Reads the budget field, refusing anything that is not a usable whole number.
 *
 * Throwing beats omitting: an omitted field leaves the box showing what the user typed
 * while the saved value stays what it was, which is a settings screen that lies. The
 * message names the bounds because the only way to fix this is to type a different
 * number.
 */
function parseBudget(raw: string): number {
  const budget = Number(raw.trim());
  if (!Number.isInteger(budget) || budget < 1 || raw.trim().length === 0) {
    throw new Error(
      `Window text budget must be a whole number between 1 and ${MAX_WINDOW_TEXT_CHARS}.`,
    );
  }
  if (budget > MAX_WINDOW_TEXT_CHARS) {
    throw new Error(
      `Window text budget cannot be more than ${MAX_WINDOW_TEXT_CHARS} characters — past that ` +
        'one window outweighs everything else in the prompt.',
    );
  }
  return budget;
}

/**
 * Reads the base URL boxes into the override map.
 *
 * Every preset is shown, so the map is sent whole and a box emptied by the user really
 * does go back to the preset's URL. A value is checked here, with the service named,
 * because the schema's own complaint would point at `providerBaseUrls.openrouter`.
 */
function parseBaseUrls(boxes: SettingsFormValues['baseUrls']): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const box of boxes) {
    const value = box.value.trim();
    if (value.length === 0) continue;
    if (!URL.canParse(value)) {
      throw new Error(
        `${box.label} base URL must be a full URL, such as https://example.com/v1 — or blank for the default.`,
      );
    }
    overrides[box.providerId] = value;
  }
  return overrides;
}
