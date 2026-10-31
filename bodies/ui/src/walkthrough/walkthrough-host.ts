/**
 * What the walkthrough needs from its host: the key calls it shares with Settings, the expert
 * check, finishing the tour, and the settings and voice calls steps 4 and 5 use. Contains
 * WalkthroughHost and WalkthroughSettings.
 */

import type { ExpertStatus, HostBridge } from '../host-bridge';

/**
 * The slice of the host's settings the steps read and write. Plain strings: the host
 * validates a patch itself (an unknown talk key or voice is refused there).
 */
export interface WalkthroughSettings {
  hotkeys: {
    ask: string;
    pauseSight?: string | undefined;
    stopVoice?: string | undefined;
    talk?: string | undefined;
  };
  voice: {
    enabled: boolean;
    voice: string;
    speed: number;
    microphoneId?: string | undefined;
    mouth?: string | undefined;
    ears?: string | undefined;
  };
}

/** What the step 5 preview plays. */
export interface VoicePreview {
  text: string;
  mouth: 'kokoro' | 'system';
  voice: string;
  speed: number;
}

export type WalkthroughHost = Pick<
  HostBridge,
  'keyStatus' | 'setKey' | 'setDailyLimit' | 'onBrainChanged' | 'openWalkthrough'
> & {
  expertStatus(): Promise<ExpertStatus>;
  /** Marks the tour seen and closes its window. Only Finish and Skip tour call it. */
  finishWalkthrough(): Promise<void>;
  getSettings(): Promise<WalkthroughSettings>;
  /** A patch replaces each top-level object it names, so a step sends the whole object. */
  saveSettings(patch: Partial<WalkthroughSettings>): Promise<unknown>;
  previewVoice(preview: VoicePreview): Promise<void>;
  listMicrophones(): Promise<{ id: string; label: string }[]>;
};
