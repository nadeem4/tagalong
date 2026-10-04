import { describe, expect, it } from 'vitest';
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';

import { buildSettingsPatch } from './settings-form';
import type { SettingsFormValues } from './settings-form';

const values: SettingsFormValues = {
  baseUrls: [
    { providerId: 'nebius', label: 'Token Factory', value: '' },
    { providerId: 'openrouter', label: 'OpenRouter', value: '' },
  ],
  askHotkey: 'CommandOrControl+Shift+Space',
  lookHotkey: 'CommandOrControl+Shift+S',
  seeEverythingHotkey: 'CommandOrControl+Shift+Alt+S',
  pauseSightHotkey: 'CommandOrControl+Shift+Alt+P',
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
  it('carries all four hotkeys, because a patch replaces the whole object', () => {
    // The bug this exists to prevent: the form sent only ask and look, so every save
    // silently dropped the two 2B bindings and fell back to their defaults. Nothing
    // failed, nothing warned, and a rebound see-everything key just stopped being the
    // one the user typed.
    const patch = buildSettingsPatch(values);

    expect(patch.hotkeys).toEqual({
      ask: 'CommandOrControl+Shift+Space',
      look: 'CommandOrControl+Shift+S',
      seeEverything: 'CommandOrControl+Shift+Alt+S',
      pauseSight: 'CommandOrControl+Shift+Alt+P',
    });
  });

  it('keeps a rebound hotkey exactly as typed', () => {
    const patch = buildSettingsPatch({ ...values, seeEverythingHotkey: 'CommandOrControl+Alt+V' });
    expect(patch.hotkeys?.seeEverything).toBe('CommandOrControl+Alt+V');
    expect(patch.hotkeys?.pauseSight).toBe('CommandOrControl+Shift+Alt+P');
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

  it('sends no summarizer when both boxes are blank, meaning each pet’s own brain', () => {
    const patch = buildSettingsPatch({
      ...values,
      summarizerProviderId: '',
      summarizerModel: '  ',
    });
    expect(patch.summarizer).toBeNull();
  });

  it('carries a summarizer provider and model', () => {
    const patch = buildSettingsPatch({
      ...values,
      summarizerProviderId: 'openrouter',
      summarizerModel: ' anthropic/claude-haiku-4.5 ',
    });
    expect(patch.summarizer).toEqual({
      providerId: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
    });
  });

  it('refuses a summarizer model with no provider, or a provider with no model', () => {
    expect(() =>
      buildSettingsPatch({ ...values, summarizerProviderId: '', summarizerModel: 'm' }),
    ).toThrow(/summarizer/i);
    expect(() =>
      buildSettingsPatch({ ...values, summarizerProviderId: 'nebius', summarizerModel: '' }),
    ).toThrow(/summarizer/i);
  });
});
