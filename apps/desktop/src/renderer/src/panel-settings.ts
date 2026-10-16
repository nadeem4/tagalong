/**
 * The few settings the bubble shows (the ask and talk keys as a person reads them, the
 * microphone, the user's name), read at open and on every save. Used by panel.tsx.
 */
import type { Settings } from '@tagalong/protocol';

/** The talk key until settings say otherwise. Matches main's DEFAULT_TALK_HOTKEY. */
export const DEFAULT_TALK_KEY = 'CommandOrControl+Shift+Alt+Space';

/** An accelerator as a person reads it on this platform. */
export function readable(accelerator: string, platform: string): string {
  return accelerator.replace('CommandOrControl', platform === 'darwin' ? 'Cmd' : 'Ctrl');
}

/** What the panel takes from settings: read at open and again on every save. */
export interface PanelSettings {
  hotkeyLabel: string;
  talkKey: string;
  microphoneId: string | undefined;
  userName: string;
}

export function panelSettings(settings: Settings, platform: string): PanelSettings {
  return {
    hotkeyLabel: readable(settings.hotkeys.ask, platform),
    talkKey: readable(settings.hotkeys.talk ?? DEFAULT_TALK_KEY, platform),
    microphoneId: settings.voice.microphoneId,
    userName: settings.userName,
  };
}
