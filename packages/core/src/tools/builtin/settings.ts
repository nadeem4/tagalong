import { randomUUID } from 'node:crypto';
import {
  EARS_IDS,
  MOUTH_IDS,
  SETTINGS_DEFAULTS,
  SettingsPatch,
  VOICE_IDS,
  type Settings,
  type SettingsChangeRow,
  type SettingsProposedParams,
} from '@tagalong/protocol';
import type { BrainTool } from '../../providers';
import { hideSecrets } from '../../privacy/secrets';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

/**
 * Change settings by talking: "talk a bit slower and call me Sam". The tool only builds and
 * checks a patch and shows the settings card; nothing is saved until the person clicks
 * Apply, and the host saves it through its ordinary settings path. `write`, like
 * `create_routine`, because an applied card outlives the turn.
 *
 * Only the settings on the chat allowlist below are reachable. Keys, logins, provider URLs,
 * the calendar link and the model are not: they live in the keychain or in Settings, and
 * this tool has no path to either.
 */
export const CHANGE_SETTINGS = 'change_settings';

export interface SettingsToolDeps {
  /** The settings now, read each turn: the card's "now" column and the description. */
  get(): Settings;
  /** Shows the settings card (`settings.proposed`). */
  emit(params: SettingsProposedParams): void;
}

type Patch = Record<string, unknown>;
type Parsed = { value: unknown } | string;

/** One setting chat may change, and how. */
interface Entry {
  label: string;
  read(settings: Settings): unknown;
  /** The value as the card holds it, or why it cannot be. */
  parse(value: unknown, settings: Settings): Parsed;
  /** Lays the value into the patch, over the current value of its object. */
  apply(patch: Patch, value: unknown, settings: Settings): void;
  show(value: unknown): string;
  /** Whether going from `from` to `to` lets Scout see, keep or spend more. */
  loosens?(from: unknown, to: unknown): boolean;
  note?(to: unknown): string | undefined;
}

const SEES_MORE = 'Lets Scout see or keep more of your screen';

const onOff = (value: unknown): string => (value === true ? 'On' : 'Off');
const plain = (value: unknown): string => String(value);
const turnsOn = (from: unknown, to: unknown): boolean => from !== true && to === true;

const bool = (value: unknown): Parsed =>
  typeof value === 'boolean' ? { value } : 'needs true or false.';
const num = (value: unknown): Parsed =>
  typeof value === 'number' && Number.isFinite(value) ? { value } : 'needs a number.';
const text = (value: unknown): Parsed =>
  typeof value === 'string' ? { value: value.trim() } : 'needs text.';
const oneOf =
  (options: readonly string[]) =>
  (value: unknown): Parsed =>
    typeof value === 'string' && options.includes(value)
      ? { value }
      : `must be one of ${options.join(', ')}.`;

/** A field of an object setting: the rest of the object is kept, never wiped. */
function field(
  top: 'voice' | 'hotkeys' | 'listening' | 'rollingMemory' | 'sightLog' | 'budget' | 'wellbeing',
  key: string,
  entry: Omit<Entry, 'read' | 'apply'>,
): Entry {
  const defaults = SETTINGS_DEFAULTS[top] as Record<string, unknown>;
  return {
    ...entry,
    read: (settings) => (settings[top] as Record<string, unknown>)[key] ?? defaults[key],
    apply: (patch, value, settings) => {
      patch[top] = { ...((patch[top] as object | undefined) ?? settings[top]), [key]: value };
    },
  };
}

/** A whole top-level setting. */
function whole(top: keyof Settings, entry: Omit<Entry, 'read' | 'apply'>): Entry {
  return {
    ...entry,
    read: (settings) => settings[top],
    apply: (patch, value) => {
      patch[top] = value;
    },
  };
}

const retentionHours = (value: unknown): number =>
  typeof value === 'object' && value !== null && (value as { mode?: string }).mode === 'hours'
    ? ((value as { hours?: number }).hours ?? 0)
    : 0;

/** Exclusions are added by talk, never removed: text on screen could ask for that. */
const exclusionAdd: Entry = {
  label: 'Never look at',
  read: () => '(not listed)',
  parse: (value, settings) => {
    const parsed = text(value);
    if (typeof parsed === 'string') return parsed;
    const entry = parsed.value as string;
    if (entry === '') return 'needs an app (such as Signal.exe) or a window title pattern.';
    const { processNames, titlePatterns } = settings.captureExclusions;
    const listed = [...processNames, ...titlePatterns].some(
      (existing) => existing.toLowerCase() === entry.toLowerCase(),
    );
    return { value: listed ? '(not listed)' : entry };
  },
  apply: (patch, value, settings) => {
    if (value === '(not listed)') return;
    const current = (patch['captureExclusions'] as Settings['captureExclusions'] | undefined) ?? {
      processNames: [...settings.captureExclusions.processNames],
      titlePatterns: [...settings.captureExclusions.titlePatterns],
    };
    const entry = value as string;
    const isApp = /\.exe$/i.test(entry);
    patch['captureExclusions'] = {
      processNames: isApp ? [...current.processNames, entry] : current.processNames,
      titlePatterns: isApp ? current.titlePatterns : [...current.titlePatterns, entry],
    };
  },
  show: plain,
};

const hotkey = (key: string, label: string): Entry =>
  field('hotkeys', key, { label, parse: text, show: plain });

/** The chat allowlist. Every other setting is out of reach of talk. */
const ALLOWED: Record<string, Entry> = {
  'voice.enabled': field('voice', 'enabled', { label: 'Speak aloud', parse: bool, show: onOff }),
  'voice.voice': field('voice', 'voice', { label: 'Voice', parse: oneOf(VOICE_IDS), show: plain }),
  'voice.speed': field('voice', 'speed', { label: 'Voice speed', parse: num, show: plain }),
  'voice.elevenLabsVoiceId': field('voice', 'elevenLabsVoiceId', {
    label: 'ElevenLabs voice',
    parse: text,
    show: (value) => (value === '' ? '(none)' : String(value)),
  }),
  'voice.mouth': field('voice', 'mouth', {
    label: 'Who speaks',
    parse: oneOf(MOUTH_IDS),
    show: (value) => (value === undefined ? '(automatic)' : String(value)),
    note: (to) => (to === 'elevenlabs' ? 'Needs an ElevenLabs key in Settings' : undefined),
  }),
  'voice.ears': field('voice', 'ears', {
    label: 'Who listens',
    parse: oneOf(EARS_IDS),
    // Absent means the local ears by default; choosing them writes the choice down.
    show: (value) => (value === undefined ? 'local (default)' : String(value)),
  }),
  'listening.always': field('listening', 'always', {
    label: 'Always listening',
    parse: (value) => (value === false ? { value } : ONLY_YOU),
    show: onOff,
  }),
  userName: whole('userName', {
    label: 'Your name',
    parse: text,
    show: (value) => (value === '' ? '(none)' : String(value)),
  }),
  greeting: whole('greeting', { label: 'Hello when Tagalong opens', parse: bool, show: onOff }),
  'hotkeys.ask': hotkey('ask', 'Ask key'),
  'hotkeys.talk': hotkey('talk', 'Talk key'),
  'hotkeys.pauseSight': hotkey('pauseSight', 'Pause sight key'),
  'hotkeys.stopVoice': hotkey('stopVoice', 'Stop voice key'),
  keepAnEye: whole('keepAnEye', {
    label: 'Keep an eye on things',
    parse: bool,
    show: onOff,
    loosens: turnsOn,
  }),
  sightDetail: whole('sightDetail', {
    label: 'Sight detail',
    parse: oneOf(['focused', 'all']),
    show: plain,
    loosens: (from, to) => from !== 'all' && to === 'all',
  }),
  windowTextBudget: whole('windowTextBudget', {
    label: 'Window text read size',
    parse: num,
    show: (value) => `${String(value)} characters`,
  }),
  'rollingMemory.enabled': field('rollingMemory', 'enabled', {
    label: 'Screen memory',
    parse: bool,
    show: onOff,
    loosens: turnsOn,
  }),
  'rollingMemory.minutes': field('rollingMemory', 'minutes', {
    label: 'Screen memory length',
    parse: num,
    show: (value) => `${String(value)} minutes`,
    loosens: (from, to) => (to as number) > (from as number),
  }),
  screenshotRetention: whole('screenshotRetention', {
    label: 'Keep screenshots',
    parse: (value) => {
      if (value === 'off' || value === 0 || value === false) return { value: { mode: 'off' } };
      if (typeof value === 'number') return { value: { mode: 'hours', hours: value } };
      return 'needs "off" or a number of hours.';
    },
    show: (value) => {
      const hours = retentionHours(value);
      return hours === 0 ? 'Off' : `${hours} hours`;
    },
    loosens: (from, to) => retentionHours(to) > retentionHours(from),
  }),
  'captureExclusions.add': exclusionAdd,
  'wellbeing.enabled': field('wellbeing', 'enabled', {
    label: 'Gentle nudges',
    parse: bool,
    show: onOff,
  }),
  'sightLog.days': field('sightLog', 'days', {
    label: 'Keep the log of what Scout saw',
    parse: (value, settings) => {
      const parsed = num(value);
      if (typeof parsed === 'string') return parsed;
      return (parsed.value as number) > settings.sightLog.days
        ? 'I can only lower how long the log is kept. Raising it is in Settings › Privacy.'
        : parsed;
    },
    show: (value) => `${String(value)} days`,
  }),
  pickUp: whole('pickUp', {
    label: 'Pick up where you left off',
    parse: bool,
    show: onOff,
    loosens: turnsOn,
    note: (to) => (to === false ? 'Deletes the snapshot kept now' : undefined),
  }),
  'budget.dailyUsd': field('budget', 'dailyUsd', {
    label: 'Daily spending cap',
    parse: (value) =>
      value === null || value === 'none' || value === 'off' ? { value: null } : num(value),
    show: (value) => (value === null ? 'No cap' : `$${String(value)} a day`),
    loosens: (from, to) => from !== null && (to === null || (to as number) > (from as number)),
  }),
};

export const CHAT_SETTINGS = Object.keys(ALLOWED);

const ONLY_YOU =
  "Only you can switch that on: it's in my bubble's header or Settings › Privacy. I never " +
  'switch Always listening on myself.';

/** Asked for by name and refused by name, before anything else is looked at. */
const REFUSED: [RegExp, string][] = [
  [
    /calendar|\bics\b|\.ics/,
    "The calendar link is changed only in Settings or Home's Meeting prep form, never in chat.",
  ],
  [
    /url|endpoint|base/,
    'Provider URLs are changed only in Settings. I never set where a key is sent.',
  ],
  [
    /key|token|secret|password|login|sign.?in|credential/,
    'API keys, logins and tokens are changed only in Settings. I never see them, so never ' +
      'paste one in chat.',
  ],
  [
    /model|provider|brain|reply|notes|summar/,
    'Your model, provider and my own notes are changed only in Settings.',
  ],
  [
    /seeing|pause|sight\b/,
    "That's not a setting: use the Seeing switch in my bubble or the pause key.",
  ],
  [/exclusion|exclude/, 'Removing a capture exclusion is done only in Settings › Privacy.'],
];

function refusal(setting: string): string {
  const name = setting.toLowerCase();
  for (const [pattern, message] of REFUSED) if (pattern.test(name)) return message;
  const shown = hideSecrets(setting).slice(0, 60);
  return `'${shown}' is not something I can change by talk. I can change: ${CHAT_SETTINGS.join(', ')}.`;
}

const LOOSENING_ON_ROUTINE =
  "A routine can't ask to let me see, keep or spend more. Ask the person to change it " +
  'themselves, by talking to me or in Settings.';

const SHOWN =
  'The settings card is in front of the person. Tell them in one line to check it and click ' +
  'Apply (Turn on, for a change marked as letting you see or keep more); nothing changes until ' +
  'they click. A spoken "yes" does not apply it.';

function currentValues(settings: Settings): string {
  return Object.entries(ALLOWED)
    .filter(([name]) => name !== 'captureExclusions.add')
    .map(([name, entry]) => `- ${name}: ${hideSecrets(entry.show(entry.read(settings)))}`)
    .join('\n');
}

function definition(settings: Settings): BrainTool {
  return {
    name: CHANGE_SETTINGS,
    description:
      'Change one or more of the person’s Tagalong settings when they ask ("talk a bit slower ' +
      'and call me Sam"). It shows them a card with each setting now and after; nothing changes ' +
      'until they click Apply, so never say it is done. A spoken "yes" never applies it. ' +
      'voice and hotkeys fields change one at a time and keep the rest. captureExclusions.add ' +
      'adds an app (such as Signal.exe) or a window title pattern (such as *bank*) Scout never ' +
      'looks at; removing one is only in Settings. sightLog.days can only go down. ' +
      'listening.always can only be switched off: if they ask to switch it on, say only they ' +
      "can, in the bubble's header or Settings › Privacy. API keys, logins, provider URLs, " +
      'the model and the calendar link are changed only in Settings: say so, and never ask ' +
      'for or repeat one. The Seeing switch and the pause key are not settings. Use the current ' +
      `values below to answer "what's my voice speed?" without calling this.\nCurrent values:\n` +
      currentValues(settings),
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              setting: { type: 'string', enum: CHAT_SETTINGS },
              value: {
                type: ['string', 'number', 'boolean', 'null'],
                description:
                  'The new value. screenshotRetention: "off" or hours. budget.dailyUsd: ' +
                  'dollars, or null for no cap.',
              },
            },
            required: ['setting', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
  };
}

const error = (content: string): Promise<ToolOutcome> =>
  Promise.resolve({ content, isError: true });

export function changeSettingsTool(deps: SettingsToolDeps): Tool {
  return defineTool(definition(deps.get()), 'write', (input, ctx) => {
    const changes = (input as { changes?: unknown } | null | undefined)?.changes;
    if (!Array.isArray(changes) || changes.length === 0) {
      return error('changes must be a list of { setting, value }.');
    }
    const settings = deps.get();
    const patch: Patch = {};
    const rows = new Map<string, SettingsChangeRow>();
    for (const [index, change] of changes.entries()) {
      const { setting, value } = (change ?? {}) as { setting?: unknown; value?: unknown };
      const name = typeof setting === 'string' ? setting : '';
      const entry = Object.hasOwn(ALLOWED, name) ? ALLOWED[name] : undefined;
      if (entry === undefined) return error(refusal(name));
      const parsed = entry.parse(value, settings);
      if (typeof parsed === 'string') {
        // A sentence of its own stands alone; a fragment ("needs a number.") gets the name.
        return error(/^[a-z]/.test(parsed) ? `${entry.label} (${name}) ${parsed}` : parsed);
      }
      const from = entry.read(settings);
      const to = parsed.value;
      entry.apply(patch, to, settings);
      const shownFrom = entry.show(from);
      const shownTo = entry.show(to);
      const key = name === 'captureExclusions.add' ? `${name}#${index}` : name;
      if (shownFrom === shownTo) {
        rows.delete(key);
        continue;
      }
      const loosens = entry.loosens?.(from, to) ?? false;
      const note = loosens
        ? name === 'budget.dailyUsd'
          ? 'Lets Scout spend more each day'
          : SEES_MORE
        : entry.note?.(to);
      rows.set(key, {
        setting: name,
        label: entry.label,
        from: shownFrom,
        to: shownTo,
        loosens,
        ...(note !== undefined ? { note } : {}),
      });
    }
    const checked = SettingsPatch.safeParse(patch);
    if (!checked.success) {
      return error(
        checked.error.issues
          .map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`)
          .join('; '),
      );
    }
    if (rows.size === 0) {
      return Promise.resolve({
        content: 'Those settings are already that way: nothing to change.',
      });
    }
    const list = [...rows.values()];
    if (ctx.routine !== undefined && list.some((row) => row.loosens)) {
      return error(LOOSENING_ON_ROUTINE);
    }
    deps.emit({ proposalId: randomUUID(), petId: ctx.pet.id, patch: checked.data, rows: list });
    return Promise.resolve({ content: SHOWN });
  });
}
