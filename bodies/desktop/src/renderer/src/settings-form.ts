/**
 * Turns the Settings form into a settings patch, kept apart from React so it is tested in plain
 * Node. Contains SettingsFormValues, buildSettingsPatch and its field checks, SettingsFieldError,
 * and helpers the sections share (key caps, voice facts, cleanUserName).
 */
import {
  MAX_ROLLING_MEMORY_MINUTES,
  MAX_SIGHT_LOG_DAYS,
  MIN_SIGHT_LOG_DAYS,
  MAX_USER_NAME_CHARS,
  MAX_VOICE_SPEED,
  MAX_WINDOW_TEXT_CHARS,
  MIN_VOICE_SPEED,
  SettingsPatch,
} from '@tagalong/protocol';
import type { SettingsPatch as SettingsPatchType, VoiceAdapterFacts } from '@tagalong/protocol';

/** The settings form's raw values, as `FormData` hands them over: every field a string. */
export interface SettingsFormValues {
  askHotkey: string;
  pauseSightHotkey: string;
  stopVoiceHotkey: string;
  talkHotkey: string;
  sightDetail: string;
  windowTextBudget: string;
  /** Whether Scout greets you on a later launch. Absent leaves the setting alone. */
  greeting?: boolean;
  /** Whether Scout keeps an eye on things. Absent leaves the setting alone. */
  keepAnEye?: boolean;
  /** Whether Scout keeps a pick-up snapshot. Absent leaves the setting alone. */
  pickUp?: boolean;
  /** Whether Scout gives gentle nudges. Absent leaves the setting alone. */
  wellbeing?: boolean;
  /** What Scout calls you. Blank clears it; absent leaves the setting alone. */
  userName?: string;
  /** Present together when the form shows rolling memory and the watches. */
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
  /** The microphone Talk to Scout listens on. Blank: the system default. */
  microphoneId?: string;
  mouth?: string;
  ears?: string;
  /** How many days What Scout saw keeps. Absent leaves the setting alone. */
  sightLogDays?: string;
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
  'sightDetail',
  'windowTextBudget',
  'rollingMemoryMinutes',
  'watchMaxChecks',
  'watchMaxConcurrent',
  'watchTimeoutMinutes',
  'elevenLabsVoiceId',
]);

export function isAdvancedField(field: string): boolean {
  return ADVANCED_FIELDS.has(field) || field.startsWith('key:');
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
  refuseSharedHotkeys(values);
  return SettingsPatch.parse({
    hotkeys: {
      ask: values.askHotkey.trim(),
      pauseSight: values.pauseSightHotkey.trim(),
      stopVoice: values.stopVoiceHotkey.trim(),
      talk: values.talkHotkey.trim(),
    },
    ...(values.voice !== undefined
      ? {
          voice: {
            enabled: values.voiceEnabled === true,
            voice: values.voice,
            speed: parseSpeed(values.voiceSpeed ?? ''),
            elevenLabsVoiceId: (values.elevenLabsVoiceId ?? '').trim(),
            ...(values.microphoneId !== undefined && values.microphoneId !== ''
              ? { microphoneId: values.microphoneId }
              : {}),
            ...(values.mouth !== undefined && values.mouth !== '' ? { mouth: values.mouth } : {}),
            ...(values.ears !== undefined && values.ears !== '' ? { ears: values.ears } : {}),
          },
        }
      : {}),
    sightDetail: values.sightDetail,
    windowTextBudget: parseBudget(values.windowTextBudget),
    ...(values.greeting !== undefined ? { greeting: values.greeting } : {}),
    ...(values.keepAnEye !== undefined ? { keepAnEye: values.keepAnEye } : {}),
    ...(values.pickUp !== undefined ? { pickUp: values.pickUp } : {}),
    ...(values.wellbeing !== undefined ? { wellbeing: { enabled: values.wellbeing } } : {}),
    ...(values.userName !== undefined ? { userName: cleanUserName(values.userName) } : {}),
    ...(values.sightLogDays !== undefined
      ? {
          sightLog: {
            days: wholeNumber(
              'sightLogDays',
              values.sightLogDays,
              MIN_SIGHT_LOG_DAYS,
              MAX_SIGHT_LOG_DAYS,
              `What Scout saw keeps between ${MIN_SIGHT_LOG_DAYS} and ${MAX_SIGHT_LOG_DAYS} days.`,
            ),
          },
        }
      : {}),
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

/**
 * The shortcuts, in the order Settings shows them, with the names it shows. The talk key is
 * one key held alone, picked from a list, so it can never share a combination.
 */
const HOTKEY_FIELDS = [
  ['askHotkey', 'Ask Scout'],
  ['pauseSightHotkey', 'Pause sight'],
  ['stopVoiceHotkey', 'Stop Scout speaking'],
] as const;

/** An accelerator compared as keys: case, order and the spelling of Ctrl do not matter. */
function sameKeys(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .map((part) => (['commandorcontrol', 'cmdorctrl', 'control'].includes(part) ? 'ctrl' : part))
    .sort()
    .join('+');
}

/** Two shortcuts on one combination would leave one of them dead: refuse the later one. */
function refuseSharedHotkeys(values: SettingsFormValues): void {
  const seen = new Map<string, string>();
  for (const [field, label] of HOTKEY_FIELDS) {
    const keys = sameKeys(values[field]);
    if (keys === '') continue;
    const first = seen.get(keys);
    if (first !== undefined) {
      throw new SettingsFieldError(
        field,
        `${label} uses the same keys as ${first}. Pick a different combination.`,
      );
    }
    seen.set(keys, label);
  }
}

/** A name as typed, trimmed and cut to the cap: a long name is shortened, never refused. */
export function cleanUserName(raw: string): string {
  return raw.trim().slice(0, MAX_USER_NAME_CHARS).trim();
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

/** An adapter's facts as one plain line under the picker. */
export function voiceFacts(facts: VoiceAdapterFacts): string {
  return [
    facts.offline ? 'Works offline.' : 'Needs the internet.',
    facts.needsKey ? 'Needs your key.' : '',
    facts.costs ? 'Costs money.' : 'Free.',
    facts.screenshots ? 'Sends screenshots.' : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
