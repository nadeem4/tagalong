import { MAX_WINDOW_TEXT_CHARS, SettingsPatch } from '@tagalong/protocol';
import type { SettingsPatch as SettingsPatchType } from '@tagalong/protocol';

/**
 * The settings form's raw values, as `FormData` hands them over: every field a string.
 *
 * Separate from the component so the patch it builds can be tested. The desktop package
 * runs its tests in plain Node with no DOM, and the interesting part here was never the
 * rendering — it was which fields end up in the patch.
 */
export interface SettingsFormValues {
  providerId: string;
  defaultModel: string;
  askHotkey: string;
  lookHotkey: string;
  seeEverythingHotkey: string;
  pauseSightHotkey: string;
  sightDetail: string;
  windowTextBudget: string;
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
 * or the retention mode as a side effect of changing a model name.
 */
export function buildSettingsPatch(values: SettingsFormValues): SettingsPatchType {
  return SettingsPatch.parse({
    providerId: values.providerId.trim(),
    defaultModel: values.defaultModel.trim(),
    hotkeys: {
      ask: values.askHotkey.trim(),
      look: values.lookHotkey.trim(),
      seeEverything: values.seeEverythingHotkey.trim(),
      pauseSight: values.pauseSightHotkey.trim(),
    },
    sightDetail: values.sightDetail,
    windowTextBudget: parseBudget(values.windowTextBudget),
  });
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
