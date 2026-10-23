/** Tests for panelSettings: the talk key as a person reads it, and the microphone. */
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, Settings } from '@tagalong/protocol';
import { DEFAULT_TALK_KEY, panelSettings } from './panel-settings';

describe('panelSettings', () => {
  it('reads the talk key and the microphone the panel uses', () => {
    const settings = Settings.parse({
      ...SETTINGS_DEFAULTS,
      userName: 'Nadeem',
      hotkeys: { ...SETTINGS_DEFAULTS.hotkeys, ask: 'CommandOrControl+J', talk: 'RightShift' },
      voice: { ...SETTINGS_DEFAULTS.voice, microphoneId: 'usb-mic' },
    });
    expect(panelSettings(settings)).toEqual({ talkKey: 'Right Shift', microphoneId: 'usb-mic' });
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
