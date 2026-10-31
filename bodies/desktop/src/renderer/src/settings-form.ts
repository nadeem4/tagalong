/**
 * Turns the Settings form into a settings patch, kept apart from React so it is tested in plain
 * Node. Contains SettingsFormValues, buildSettingsPatch and its field checks, SettingsFieldError,
 * and helpers the sections share (key caps, voice facts).
 */
import { MAX_VOICE_SPEED, MIN_VOICE_SPEED, SettingsPatch } from '../../shared/settings';
import type { SettingsPatch as SettingsPatchType } from '../../shared/settings';
import type { VoiceAdapterFacts } from '../../shared/voice';

/** The settings form's raw values, as `FormData` hands them over: every field a string. */
export interface SettingsFormValues {
  askHotkey: string;
  pauseSightHotkey: string;
  stopVoiceHotkey: string;
  talkHotkey: string;
  /** Voice. Present together when the form shows the Voice section. */
  voiceEnabled?: boolean;
  voice?: string;
  voiceSpeed?: string;
  elevenLabsVoiceId?: string;
  /** The microphone Talk to Scout listens on. Blank: the system default. */
  microphoneId?: string;
  mouth?: string;
  ears?: string;
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
const ADVANCED_FIELDS = new Set(['elevenLabsVoiceId']);

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
 * as a side effect of changing a hotkey.
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

/** An accelerator as the keys to press: `CommandOrControl` is Cmd on a Mac, Ctrl elsewhere. */
export function keyCaps(accelerator: string, platform: string): string[] {
  const command = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  return accelerator.split('+').map((part) => (part === 'CommandOrControl' ? command : part));
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
