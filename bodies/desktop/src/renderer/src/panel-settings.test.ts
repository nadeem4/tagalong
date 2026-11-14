/** Tests for panelSettings: the talk key as a person reads it, and the microphone. */
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, Settings } from '../../shared/settings';
import { DEFAULT_TALK_KEY, panelSettings } from './panel-settings';

describe('panelSettings', () => {
  it('reads the talk key, the microphone and the voice the panel uses', () => {
    const settings = Settings.parse({
      ...SETTINGS_DEFAULTS,
      hotkeys: { ...SETTINGS_DEFAULTS.hotkeys, ask: 'CommandOrControl+J', talk: 'RightShift' },
      voice: { ...SETTINGS_DEFAULTS.voice, microphoneId: 'usb-mic', mouth: 'system', speed: 1.2 },
    });
    expect(panelSettings(settings)).toEqual({
      talkKey: 'Right Shift',
      microphoneId: 'usb-mic',
      mouth: 'system',
      speed: 1.2,
      showWords: true,
    });
  });

  it('shows words while talking unless the setting is off', () => {
    const off = Settings.parse({
      ...SETTINGS_DEFAULTS,
      voice: { ...SETTINGS_DEFAULTS.voice, showWordsWhileTalking: false },
    });
    expect(panelSettings(off).showWords).toBe(false);
    expect(panelSettings(Settings.parse(SETTINGS_DEFAULTS)).showWords).toBe(true);
  });

  it('speaks with Kokoro until another voice is picked', () => {
    expect(panelSettings(Settings.parse(SETTINGS_DEFAULTS)).mouth).toBe('kokoro');
  });

  it('falls back to Right Ctrl', () => {
    const settings = Settings.parse({
      ...SETTINGS_DEFAULTS,
      hotkeys: { ask: 'CommandOrControl+Shift+Space' },
    });
    expect(panelSettings(settings).talkKey).toBe('Right Ctrl');
    expect(DEFAULT_TALK_KEY).toBe('Right Ctrl');
  });
});
