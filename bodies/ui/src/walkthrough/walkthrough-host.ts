/**
 * What the walkthrough needs from its host: the key calls it shares with Settings, the expert
 * check, finishing the tour, and the settings, voice, browser-folder and Home calls the steps use. Contains
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
  /** Marks the tour seen; closes the window unless `close` is false (the finish card stays up). */
  finishWalkthrough(options?: { close?: boolean }): Promise<void>;
  /** Opens the Anthropic Console key page in the browser. */
  openKeyPage(): Promise<void>;
  getSettings(): Promise<WalkthroughSettings>;
  /** A patch replaces each top-level object it names, so a step sends the whole object. */
  saveSettings(patch: Partial<WalkthroughSettings>): Promise<unknown>;
  previewVoice(preview: VoicePreview): Promise<void>;
  listMicrophones(): Promise<{ id: string; label: string }[]>;
  /** Where the browser add-on's folder is (step 7). */
  browserFolder(): Promise<{ path: string; exists: boolean }>;
  showBrowserFolder(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Opens Home (the finish card's Open Home). */
  openHome(): Promise<void>;
};
