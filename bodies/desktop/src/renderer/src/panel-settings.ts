/**
 * The few settings the panel uses (the talk key as a person reads it, the microphone, who
 * speaks and how fast), read
 * at open and on every save. Used by panel.tsx.
 */
import { chosenMouth } from '../../shared/voice';
import { TALK_KEY_LABELS, TALK_KEY_RIGHT_CTRL } from '../../shared/settings';
import type { Settings } from '../../shared/settings';

/** The talk key as read until settings say otherwise: Right Ctrl, held alone. */
export const DEFAULT_TALK_KEY = TALK_KEY_LABELS[TALK_KEY_RIGHT_CTRL];

/** What the panel takes from settings: read at open and again on every save. */
export interface PanelSettings {
  talkKey: string;
  microphoneId: string | undefined;
  /** Who speaks: the brain's Kokoro audio, or the system voice. */
  mouth: 'kokoro' | 'system';
  speed: number;
}

export function panelSettings(settings: Settings): PanelSettings {
  return {
    talkKey: TALK_KEY_LABELS[settings.hotkeys.talk ?? TALK_KEY_RIGHT_CTRL],
    microphoneId: settings.voice.microphoneId,
    mouth: chosenMouth(settings.voice) === 'system' ? 'system' : 'kokoro',
    speed: settings.voice.speed,
  };
}
