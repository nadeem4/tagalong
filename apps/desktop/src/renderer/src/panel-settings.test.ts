import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, Settings } from '@tagalong/protocol';
import { panelSettings } from './panel-settings';

describe('panelSettings', () => {
  it('reads the keys, the microphone and the name the panel shows', () => {
    const settings = Settings.parse({
      ...SETTINGS_DEFAULTS,
      userName: 'Nadeem',
      hotkeys: { ...SETTINGS_DEFAULTS.hotkeys, ask: 'CommandOrControl+J', talk: 'Alt+T' },
      voice: { ...SETTINGS_DEFAULTS.voice, microphoneId: 'usb-mic' },
    });
    expect(panelSettings(settings, 'win32')).toEqual({
      hotkeyLabel: 'Ctrl+J',
      talkKey: 'Alt+T',
      microphoneId: 'usb-mic',
      userName: 'Nadeem',
    });
  });

  it('falls back to the default talk key, written for the platform', () => {
    const settings = Settings.parse({
      ...SETTINGS_DEFAULTS,
      hotkeys: { ask: 'CommandOrControl+Shift+Space' },
    });
    expect(panelSettings(settings, 'darwin').talkKey).toBe('Cmd+Shift+Alt+Space');
  });
});
