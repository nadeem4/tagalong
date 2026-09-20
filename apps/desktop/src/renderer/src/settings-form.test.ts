import { describe, expect, it } from 'vitest';
import { MAX_WINDOW_TEXT_CHARS, SETTINGS_DEFAULTS } from '@tagalong/protocol';

import { buildSettingsPatch } from './settings-form';
import type { SettingsFormValues } from './settings-form';

const values: SettingsFormValues = {
  providerId: 'anthropic',
  defaultModel: 'claude-opus-5',
  askHotkey: 'CommandOrControl+Shift+Space',
  lookHotkey: 'CommandOrControl+Shift+S',
  seeEverythingHotkey: 'CommandOrControl+Shift+Alt+S',
  pauseSightHotkey: 'CommandOrControl+Shift+Alt+P',
  sightDetail: 'focused',
  windowTextBudget: '8000',
};

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
