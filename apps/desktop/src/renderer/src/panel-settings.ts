/**
 * The few settings the panel uses (the talk key as a person reads it, the microphone), read
 * at open and on every save. Used by panel.tsx.
 */
import { TALK_KEY_LABELS, TALK_KEY_RIGHT_CTRL } from '@tagalong/protocol';
import type { Settings } from '@tagalong/protocol';

/** The talk key as read until settings say otherwise: Right Ctrl, held alone. */
export const DEFAULT_TALK_KEY = TALK_KEY_LABELS[TALK_KEY_RIGHT_CTRL];

/** What the panel takes from settings: read at open and again on every save. */
export interface PanelSettings {
  talkKey: string;
  microphoneId: string | undefined;
}

export function panelSettings(settings: Settings): PanelSettings {
  return {
    talkKey: TALK_KEY_LABELS[settings.hotkeys.talk ?? TALK_KEY_RIGHT_CTRL],
    microphoneId: settings.voice.microphoneId,
  };
}
