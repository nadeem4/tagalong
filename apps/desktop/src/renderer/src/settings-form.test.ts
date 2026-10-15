import { describe, expect, it } from 'vitest';
import { MAX_USER_NAME_CHARS, MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';

import {
  SettingsFieldError,
  buildSettingsPatch,
  isAdvancedField,
  keyCaps,
  summarizerGroups,
  summarizerValue,
  voiceFacts,
} from './settings-form';
import type { SettingsFormValues } from './settings-form';

const values: SettingsFormValues = {
  baseUrls: [
    { providerId: 'nebius', label: 'Token Factory', value: '' },
    { providerId: 'openrouter', label: 'OpenRouter', value: '' },
  ],
  askHotkey: 'CommandOrControl+Shift+Space',
  pauseSightHotkey: 'CommandOrControl+Shift+Alt+P',
  stopVoiceHotkey: 'CommandOrControl+Shift+Alt+M',
  talkHotkey: 'CommandOrControl+Shift+Alt+Space',
  sightDetail: 'focused',
  windowTextBudget: '8000',
};

describe('buildSettingsPatch base URLs', () => {
  it('sends an empty override map when every box is left blank', () => {
    expect(buildSettingsPatch(values).providerBaseUrls).toEqual({});
  });

  it('carries a trimmed override for the box that was filled', () => {
    const patch = buildSettingsPatch({
      ...values,
      baseUrls: [
        { providerId: 'nebius', label: 'Token Factory', value: '' },
        { providerId: 'openrouter', label: 'OpenRouter', value: ' http://127.0.0.1:8080/v1 ' },
      ],
    });
    expect(patch.providerBaseUrls).toEqual({ openrouter: 'http://127.0.0.1:8080/v1' });
  });

  it('refuses a base URL that is not a URL, naming the service', () => {
    expect(() =>
      buildSettingsPatch({
        ...values,
        baseUrls: [{ providerId: 'openrouter', label: 'OpenRouter', value: 'openrouter.ai' }],
      }),
    ).toThrow('OpenRouter base URL must be a full URL');
  });

  it('never sends the retired provider fields', () => {
    const patch = buildSettingsPatch(values);
    expect(patch).not.toHaveProperty('providerId');
    expect(patch).not.toHaveProperty('defaultModel');
  });
});

describe('buildSettingsPatch', () => {
  it('carries both hotkeys, because a patch replaces the whole object', () => {
    // A form that sent only the ask would silently drop a rebound pause key back to its
    // default: nothing failed, nothing warned.
    const patch = buildSettingsPatch(values);

    expect(patch.hotkeys).toEqual({
      ask: 'CommandOrControl+Shift+Space',
      pauseSight: 'CommandOrControl+Shift+Alt+P',
      stopVoice: 'CommandOrControl+Shift+Alt+M',
      talk: 'CommandOrControl+Shift+Alt+Space',
    });
  });

  it('keeps a rebound hotkey exactly as typed', () => {
    const patch = buildSettingsPatch({ ...values, askHotkey: 'CommandOrControl+Alt+V' });
    expect(patch.hotkeys?.ask).toBe('CommandOrControl+Alt+V');
    expect(patch.hotkeys?.pauseSight).toBe('CommandOrControl+Shift+Alt+P');
  });

  it('refuses one combination for two shortcuts, naming both and marking the second', () => {
    const save = () => buildSettingsPatch({ ...values, stopVoiceHotkey: 'ctrl+shift+SPACE' });
    expect(save).toThrow(SettingsFieldError);
    expect(save).toThrow(
      'Stop Scout speaking uses the same keys as Ask Scout. Pick a different combination.',
    );
    try {
      save();
    } catch (error) {
      expect((error as SettingsFieldError).field).toBe('stopVoiceHotkey');
    }
  });

  it('trims surrounding whitespace rather than sending an unregisterable accelerator', () => {
    const patch = buildSettingsPatch({ ...values, askHotkey: '  CommandOrControl+Shift+Space  ' });
    expect(patch.hotkeys?.ask).toBe('CommandOrControl+Shift+Space');
  });

  it('carries the sight detail choice', () => {
    expect(buildSettingsPatch({ ...values, sightDetail: 'all' }).sightDetail).toBe('all');
    expect(buildSettingsPatch(values).sightDetail).toBe('focused');
  });

  it('refuses a sight detail it does not know instead of sending it on', () => {
    expect(() => buildSettingsPatch({ ...values, sightDetail: 'everything' })).toThrow();
  });

  it('carries the window text budget as a number, not the string the form holds', () => {
    const patch = buildSettingsPatch({ ...values, windowTextBudget: '12000' });
    expect(patch.windowTextBudget).toBe(12_000);
  });

  it('explains a budget that is not a whole number rather than silently dropping it', () => {
    // Silently omitting it would leave the field showing the number the user typed while
    // the saved value stayed what it was — the settings equivalent of a lie.
    for (const bad of ['', 'lots', '1.5', '-200', '0']) {
      expect(() => buildSettingsPatch({ ...values, windowTextBudget: bad }), bad).toThrow(
        /whole number/i,
      );
    }
  });

  it('refuses a budget above the ceiling, naming the ceiling', () => {
    expect(() =>
      buildSettingsPatch({ ...values, windowTextBudget: String(MAX_WINDOW_TEXT_CHARS + 1) }),
    ).toThrow(new RegExp(String(MAX_WINDOW_TEXT_CHARS)));
  });

  it('accepts the shipped default and the ceiling exactly', () => {
    expect(
      buildSettingsPatch({
        ...values,
        windowTextBudget: String(SETTINGS_DEFAULTS.windowTextBudget),
      }).windowTextBudget,
    ).toBe(SETTINGS_DEFAULTS.windowTextBudget);
    expect(
      buildSettingsPatch({ ...values, windowTextBudget: String(MAX_WINDOW_TEXT_CHARS) })
        .windowTextBudget,
    ).toBe(MAX_WINDOW_TEXT_CHARS);
  });

  it('sends nothing the user did not set, so a save cannot reset a neighbouring setting', () => {
    const patch = buildSettingsPatch(values);
    expect(patch.captureExclusions).toBeUndefined();
    expect(patch.screenshotRetention).toBeUndefined();
    expect(patch.enginePort).toBeUndefined();
    expect(patch.avatar).toBeUndefined();
  });
});

describe('what a rejected save tells the user', () => {
  it('names the field, not just that something was wrong', () => {
    // A save that refuses with "invalid input" is the same lie as one that silently keeps
    // a different value: the user cannot tell which of eight fields to change.
    for (const bad of ['', 'lots', '-200', String(MAX_WINDOW_TEXT_CHARS + 1)]) {
      let message = '';
      try {
        buildSettingsPatch({ ...values, windowTextBudget: bad });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.toLowerCase(), bad).toContain('window text budget');
    }
  });

  it('says what would make it acceptable', () => {
    let message = '';
    try {
      buildSettingsPatch({ ...values, windowTextBudget: 'lots' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('1');
    expect(message).toContain(String(MAX_WINDOW_TEXT_CHARS));
  });
});

describe('buildSettingsPatch crew settings', () => {
  it('leaves crew settings out when the form does not carry them', () => {
    const patch = buildSettingsPatch(values);
    expect(patch).not.toHaveProperty('hiddenPets');
    expect(patch).not.toHaveProperty('summarizer');
  });

  it('carries the pets hidden from the desktop', () => {
    expect(buildSettingsPatch({ ...values, hiddenPets: ['bolt'] }).hiddenPets).toEqual(['bolt']);
  });

  it('sends no summarizer for "Same as Scout"', () => {
    expect(buildSettingsPatch({ ...values, summarizer: '' }).summarizer).toBeNull();
  });

  it('carries the summarizer picked from the list as a provider and a model', () => {
    const patch = buildSettingsPatch({
      ...values,
      summarizer: summarizerValue('openrouter', 'anthropic/claude-haiku-4.5:free'),
    });
    expect(patch.summarizer).toEqual({
      providerId: 'openrouter',
      model: 'anthropic/claude-haiku-4.5:free',
    });
  });

  it('refuses a summarizer choice it cannot read, naming the field', () => {
    expect(() => buildSettingsPatch({ ...values, summarizer: 'openrouter' })).toThrow(
      expect.objectContaining({ field: 'summarizer' }),
    );
  });
});

describe('summarizerGroups', () => {
  const providers = [
    { id: 'claude-code', label: 'Your Claude sign-in', needsKey: false, hasKey: false },
    { id: 'openrouter', label: 'OpenRouter', needsKey: true, hasKey: true },
    { id: 'nebius', label: 'Token Factory', needsKey: true, hasKey: false },
  ];
  const models = { openrouter: ['anthropic/claude-haiku-4.5', 'nvidia/nemotron'] };

  it('offers Haiku and Sonnet on the Claude sign-in, then each keyed service that has a key', () => {
    expect(summarizerGroups({ providers, signIn: 'signed-in', models, current: null })).toEqual([
      {
        label: 'Claude sign-in',
        options: [
          { value: summarizerValue('claude-code', 'haiku'), label: 'Haiku' },
          { value: summarizerValue('claude-code', 'sonnet'), label: 'Sonnet' },
        ],
      },
      {
        label: 'OpenRouter',
        options: [
          {
            value: summarizerValue('openrouter', 'anthropic/claude-haiku-4.5'),
            label: 'anthropic/claude-haiku-4.5',
          },
          { value: summarizerValue('openrouter', 'nvidia/nemotron'), label: 'nvidia/nemotron' },
        ],
      },
    ]);
  });

  it('leaves the Claude sign-in out when it was not found', () => {
    const groups = summarizerGroups({ providers, signIn: 'not-installed', models, current: null });
    expect(groups.map((group) => group.label)).toEqual(['OpenRouter']);
  });

  it('keeps the saved summarizer listed even when its service is no longer offered', () => {
    const groups = summarizerGroups({
      providers,
      signIn: 'not-installed',
      models: {},
      current: { providerId: 'nebius', model: 'meta/llama' },
    });
    expect(groups).toContainEqual({
      label: 'Token Factory',
      options: [{ value: summarizerValue('nebius', 'meta/llama'), label: 'meta/llama' }],
    });
  });
});

describe('advanced field errors', () => {
  it('names the field a refused value belongs to, so Settings can open Advanced on it', () => {
    let caught: unknown;
    try {
      buildSettingsPatch({
        ...values,
        rollingMemoryEnabled: false,
        rollingMemoryMinutes: '10',
        watchMaxChecks: '60',
        watchMaxConcurrent: '40',
        watchTimeoutMinutes: '30',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SettingsFieldError);
    expect(caught).toMatchObject({ field: 'watchMaxConcurrent' });
    expect(isAdvancedField('watchMaxConcurrent')).toBe(true);
    expect(isAdvancedField('baseUrl:openrouter')).toBe(true);
    expect(isAdvancedField('askHotkey')).toBe(false);
  });

  it('names the base URL box and the budget box too', () => {
    expect(() =>
      buildSettingsPatch({
        ...values,
        baseUrls: [{ providerId: 'openrouter', label: 'OpenRouter', value: 'nope' }],
      }),
    ).toThrow(expect.objectContaining({ field: 'baseUrl:openrouter' }));
    expect(() => buildSettingsPatch({ ...values, windowTextBudget: 'x' })).toThrow(
      expect.objectContaining({ field: 'windowTextBudget' }),
    );
  });
});

describe('keyCaps', () => {
  it('shows an accelerator as the keys to press on this computer', () => {
    expect(keyCaps('CommandOrControl+Shift+Alt+P', 'win32')).toEqual(['Ctrl', 'Shift', 'Alt', 'P']);
    expect(keyCaps('CommandOrControl+Shift+Space', 'darwin')).toEqual(['Cmd', 'Shift', 'Space']);
  });
});

describe('buildSettingsPatch greeting', () => {
  it('carries the greeting switch when the form shows it', () => {
    expect(buildSettingsPatch({ ...values, greeting: false }).greeting).toBe(false);
    expect(buildSettingsPatch({ ...values, greeting: true }).greeting).toBe(true);
  });

  it('leaves it alone when the form does not show it', () => {
    expect(buildSettingsPatch(values).greeting).toBeUndefined();
  });
});

describe('buildSettingsPatch userName', () => {
  it('carries the name, trimmed, and an emptied box clears it', () => {
    expect(buildSettingsPatch({ ...values, userName: '  Nadeem ' }).userName).toBe('Nadeem');
    expect(buildSettingsPatch({ ...values, userName: '   ' }).userName).toBe('');
  });

  it('cuts a long name to the cap rather than refusing the save', () => {
    expect(buildSettingsPatch({ ...values, userName: 'a'.repeat(60) }).userName).toBe(
      'a'.repeat(MAX_USER_NAME_CHARS),
    );
  });

  it('leaves it alone when the form does not show it', () => {
    expect(buildSettingsPatch(values).userName).toBeUndefined();
  });
});

describe('buildSettingsPatch pickUp', () => {
  it('carries the pick-up switch when the form shows it, and leaves it alone otherwise', () => {
    expect(buildSettingsPatch({ ...values, pickUp: false }).pickUp).toBe(false);
    expect(buildSettingsPatch({ ...values, pickUp: true }).pickUp).toBe(true);
    expect(buildSettingsPatch(values).pickUp).toBeUndefined();
  });
});

describe('buildSettingsPatch keepAnEye', () => {
  it('carries the keep-an-eye switch when the form shows it', () => {
    expect(buildSettingsPatch({ ...values, keepAnEye: false }).keepAnEye).toBe(false);
    expect(buildSettingsPatch({ ...values, keepAnEye: true }).keepAnEye).toBe(true);
  });

  it('leaves it alone when the form does not show it', () => {
    expect(buildSettingsPatch(values).keepAnEye).toBeUndefined();
  });
});

describe('buildSettingsPatch sightLogDays', () => {
  it('carries how many days What Scout saw keeps', () => {
    expect(buildSettingsPatch({ ...values, sightLogDays: ' 3 ' }).sightLog).toEqual({ days: 3 });
  });

  it('refuses a number of days outside 1 to 30, naming the field', () => {
    for (const bad of ['0', '31', '2.5', '', 'week']) {
      expect(() => buildSettingsPatch({ ...values, sightLogDays: bad })).toThrow(
        expect.objectContaining({ field: 'sightLogDays' }),
      );
    }
  });

  it('leaves it alone when the form does not show it', () => {
    expect(buildSettingsPatch(values).sightLog).toBeUndefined();
  });
});

describe('buildSettingsPatch awareness', () => {
  const awareness = {
    rollingMemoryEnabled: true,
    rollingMemoryMinutes: '5',
    watchMaxChecks: '40',
    watchMaxConcurrent: '2',
    watchTimeoutMinutes: '15',
  };

  it('carries rolling memory and the watch limits when the form shows them', () => {
    const patch = buildSettingsPatch({ ...values, ...awareness });
    expect(patch.rollingMemory).toEqual({ enabled: true, minutes: 5 });
    expect(patch.watch).toEqual({ maxChecks: 40, maxConcurrent: 2, defaultTimeoutMinutes: 15 });
  });

  it('leaves both alone when the form does not show them', () => {
    const patch = buildSettingsPatch(values);
    expect(patch.rollingMemory).toBeUndefined();
    expect(patch.watch).toBeUndefined();
  });

  it('refuses minutes outside one to thirty, saying the bounds', () => {
    expect(() =>
      buildSettingsPatch({ ...values, ...awareness, rollingMemoryMinutes: '45' }),
    ).toThrow(/1 and 30/);
  });

  it('refuses a watch limit that is not a positive whole number', () => {
    expect(() => buildSettingsPatch({ ...values, ...awareness, watchMaxChecks: '0' })).toThrow(
      /checks/i,
    );
    expect(() =>
      buildSettingsPatch({ ...values, ...awareness, watchMaxConcurrent: 'two' }),
    ).toThrow(/at once/i);
  });
});

describe('buildSettingsPatch voice', () => {
  const voice = {
    voiceEnabled: true,
    voice: 'bm_fable',
    voiceSpeed: '1.05',
    elevenLabsVoiceId: '  abc123  ',
  };

  it('carries the switch, the voice, the speed and a trimmed ElevenLabs voice', () => {
    expect(buildSettingsPatch({ ...values, ...voice }).voice).toEqual({
      enabled: true,
      voice: 'bm_fable',
      speed: 1.05,
      elevenLabsVoiceId: 'abc123',
    });
  });

  it('keeps a picked microphone, and leaves it out for the system default', () => {
    expect(
      buildSettingsPatch({ ...values, ...voice, microphoneId: 'usb-mic' }).voice?.microphoneId,
    ).toBe('usb-mic');
    expect(buildSettingsPatch({ ...values, ...voice, microphoneId: '' }).voice).not.toHaveProperty(
      'microphoneId',
    );
  });

  it('carries the picked mouth and ears', () => {
    expect(
      buildSettingsPatch({ ...values, ...voice, mouth: 'system', ears: 'local' }).voice,
    ).toMatchObject({
      mouth: 'system',
      ears: 'local',
    });
    expect(buildSettingsPatch({ ...values, ...voice }).voice).not.toHaveProperty('mouth');
  });

  it('turns Scout quiet when the switch is off', () => {
    expect(buildSettingsPatch({ ...values, ...voice, voiceEnabled: false }).voice?.enabled).toBe(
      false,
    );
  });

  it('leaves the voice alone when the form does not show it', () => {
    expect(buildSettingsPatch(values)).not.toHaveProperty('voice');
  });

  it('refuses a speed outside what still sounds like speech, naming the field', () => {
    expect(() => buildSettingsPatch({ ...values, ...voice, voiceSpeed: '2' })).toThrow(
      expect.objectContaining({ field: 'voiceSpeed' }),
    );
  });

  it('opens Advanced for a refused ElevenLabs field', () => {
    expect(isAdvancedField('elevenLabsVoiceId')).toBe(true);
    expect(isAdvancedField('key:elevenlabs')).toBe(true);
    expect(isAdvancedField('voiceSpeed')).toBe(false);
  });
});

describe('voiceFacts', () => {
  it('says plainly what an adapter needs and costs', () => {
    const facts = { id: 'x', slot: 'mouth', label: 'X', screenshots: false } as const;
    expect(voiceFacts({ ...facts, offline: true, needsKey: false, costs: false })).toBe(
      'Works offline. Free.',
    );
    expect(voiceFacts({ ...facts, offline: false, needsKey: true, costs: true })).toBe(
      'Needs the internet. Needs your key. Costs money.',
    );
  });
});
