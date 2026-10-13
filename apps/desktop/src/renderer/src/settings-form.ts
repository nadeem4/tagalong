import {
  MAX_ROLLING_MEMORY_MINUTES,
  MAX_VOICE_SPEED,
  MAX_WINDOW_TEXT_CHARS,
  MIN_VOICE_SPEED,
  SettingsPatch,
} from '@tagalong/protocol';
import type { SettingsPatch as SettingsPatchType } from '@tagalong/protocol';
import type { ClaudeSignIn, ProviderChoice } from '../../shared/ipc';

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
  pauseSightHotkey: string;
  stopVoiceHotkey: string;
  sightDetail: string;
  windowTextBudget: string;
  /** Phase 4. The pets unticked under "Show on desktop". Absent leaves the setting alone. */
  hiddenPets?: readonly string[];
  /** The summarizer list's value: blank for "Same as Scout", else `summarizerValue(…)`. */
  summarizer?: string;
  /** Whether Scout greets you on a later launch. Absent leaves the setting alone. */
  greeting?: boolean;
  /** Whether Scout keeps an eye on things. Absent leaves the setting alone. */
  keepAnEye?: boolean;
  /** Phase 3B. Present together when the form shows rolling memory and the watches. */
  rollingMemoryEnabled?: boolean;
  rollingMemoryMinutes?: string;
  watchMaxChecks?: string;
  watchMaxConcurrent?: string;
  watchTimeoutMinutes?: string;
  /** Voice. Present together when the form shows the Voice section. */
  voiceEnabled?: boolean;
  voice?: string;
  voiceSpeed?: string;
  elevenLabsVoiceId?: string;
}

/**
 * A value Settings refused, with the form field it came from, so the page can open the
 * part it sits in and mark that field rather than only printing the sentence.
 */
export class SettingsFieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'SettingsFieldError';
  }
}

/** The fields that live under Advanced: a refusal on one of them opens it. */
const ADVANCED_FIELDS = new Set([
  'summarizer',
  'sightDetail',
  'windowTextBudget',
  'rollingMemoryMinutes',
  'watchMaxChecks',
  'watchMaxConcurrent',
  'watchTimeoutMinutes',
  'elevenLabsVoiceId',
]);

export function isAdvancedField(field: string): boolean {
  return ADVANCED_FIELDS.has(field) || field.startsWith('baseUrl:') || field.startsWith('key:');
}

/**
 * Turns the form into a settings patch, or throws something a user can act on.
 *
 * **Every hotkey goes in every time.** A patch replaces the whole `hotkeys` object, so a
 * form that sends only the keys it happens to display silently drops the rest back to
 * their defaults: nothing fails, nothing warns, and a rebound key quietly stops being the
 * one the user typed.
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
      pauseSight: values.pauseSightHotkey.trim(),
      stopVoice: values.stopVoiceHotkey.trim(),
    },
    ...(values.voice !== undefined
      ? {
          voice: {
            enabled: values.voiceEnabled === true,
            voice: values.voice,
            speed: parseSpeed(values.voiceSpeed ?? ''),
            elevenLabsVoiceId: (values.elevenLabsVoiceId ?? '').trim(),
          },
        }
      : {}),
    sightDetail: values.sightDetail,
    windowTextBudget: parseBudget(values.windowTextBudget),
    ...(values.hiddenPets !== undefined ? { hiddenPets: [...values.hiddenPets] } : {}),
    ...(values.summarizer !== undefined ? { summarizer: parseSummarizer(values.summarizer) } : {}),
    ...(values.greeting !== undefined ? { greeting: values.greeting } : {}),
    ...(values.keepAnEye !== undefined ? { keepAnEye: values.keepAnEye } : {}),
    ...(values.rollingMemoryMinutes !== undefined
      ? {
          rollingMemory: {
            enabled: values.rollingMemoryEnabled === true,
            minutes: wholeNumber(
              'rollingMemoryMinutes',
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
              'watchMaxChecks',
              values.watchMaxChecks,
              1,
              500,
              'Checks per watch must be a whole number between 1 and 500.',
            ),
            maxConcurrent: wholeNumber(
              'watchMaxConcurrent',
              values.watchMaxConcurrent ?? '',
              1,
              10,
              'Watches at once must be a whole number between 1 and 10.',
            ),
            defaultTimeoutMinutes: wholeNumber(
              'watchTimeoutMinutes',
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

/** The speaking speed, within what still sounds like speech. */
function parseSpeed(raw: string): number {
  const speed = Number(raw.trim());
  if (
    raw.trim() === '' ||
    !Number.isFinite(speed) ||
    speed < MIN_VOICE_SPEED ||
    speed > MAX_VOICE_SPEED
  ) {
    throw new SettingsFieldError(
      'voiceSpeed',
      `Speaking speed must be between ${MIN_VOICE_SPEED} and ${MAX_VOICE_SPEED}.`,
    );
  }
  return speed;
}

/** A whole number in bounds, or the sentence the person needs to fix it. */
function wholeNumber(
  field: string,
  raw: string,
  min: number,
  max: number,
  problem: string,
): number {
  const value = Number(raw.trim());
  if (raw.trim().length === 0 || !Number.isInteger(value) || value < min || value > max) {
    throw new SettingsFieldError(field, problem);
  }
  return value;
}

/** Joins a provider and a model into one summarizer list value. Provider ids hold no `|`. */
export function summarizerValue(providerId: string, model: string): string {
  return `${providerId}|${model}`;
}

/** Blank is "Same as Scout"; anything else must be `provider|model`. */
function parseSummarizer(raw: string): { providerId: string; model: string } | null {
  if (raw.trim().length === 0) return null;
  const split = raw.indexOf('|');
  const providerId = split < 0 ? '' : raw.slice(0, split).trim();
  const model = split < 0 ? '' : raw.slice(split + 1).trim();
  if (providerId.length === 0 || model.length === 0) {
    throw new SettingsFieldError('summarizer', 'Pick a summarizer from the list.');
  }
  return { providerId, model };
}

/** One `<optgroup>` of the summarizer list. */
export interface SummarizerGroup {
  label: string;
  options: { value: string; label: string }[];
}

/** The Claude sign-in models a summary may use. Opus is left out: a summary is small work. */
const SIGN_IN_SUMMARY_MODELS = ['haiku', 'sonnet'] as const;

/**
 * The summarizer list's groups after "Same as Scout": Haiku and Sonnet on the Claude
 * sign-in when it is signed in, then each keyed service that has a key, with its models.
 * The saved choice is always listed, so opening Settings and saving cannot drop it.
 */
export function summarizerGroups({
  providers,
  signIn,
  models,
  current,
}: {
  providers: readonly ProviderChoice[];
  signIn: ClaudeSignIn | null;
  models: Readonly<Record<string, readonly string[]>>;
  current: { providerId: string; model: string } | null;
}): SummarizerGroup[] {
  const option = (providerId: string, model: string, label = model) => ({
    value: summarizerValue(providerId, model),
    label,
  });
  const groups: SummarizerGroup[] = [];
  if (signIn === 'signed-in') {
    groups.push({
      label: 'Claude sign-in',
      options: SIGN_IN_SUMMARY_MODELS.map((model) =>
        option('claude-code', model, model[0]!.toUpperCase() + model.slice(1)),
      ),
    });
  }
  for (const provider of providers) {
    const list = models[provider.id] ?? [];
    if (!provider.needsKey || !provider.hasKey || list.length === 0) continue;
    groups.push({
      label: provider.label,
      options: list.map((model) => option(provider.id, model)),
    });
  }
  if (current !== null) {
    const value = summarizerValue(current.providerId, current.model);
    if (!groups.some((group) => group.options.some((listed) => listed.value === value))) {
      const label =
        current.providerId === 'claude-code'
          ? 'Claude sign-in'
          : (providers.find((p) => p.id === current.providerId)?.label ?? current.providerId);
      groups.push({ label, options: [option(current.providerId, current.model)] });
    }
  }
  return groups;
}

/** An accelerator as the keys to press: `CommandOrControl` is Cmd on a Mac, Ctrl elsewhere. */
export function keyCaps(accelerator: string, platform: string): string[] {
  const command = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  return accelerator.split('+').map((part) => (part === 'CommandOrControl' ? command : part));
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
    throw new SettingsFieldError(
      'windowTextBudget',
      `Window text budget must be a whole number between 1 and ${MAX_WINDOW_TEXT_CHARS}.`,
    );
  }
  if (budget > MAX_WINDOW_TEXT_CHARS) {
    throw new SettingsFieldError(
      'windowTextBudget',
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
      throw new SettingsFieldError(
        `baseUrl:${box.providerId}`,
        `${box.label} base URL must be a full URL, such as https://example.com/v1 — or blank for the default.`,
      );
    }
    overrides[box.providerId] = value;
  }
  return overrides;
}
