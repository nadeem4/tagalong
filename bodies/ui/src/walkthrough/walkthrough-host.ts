/**
 * What the walkthrough needs from its host: the key calls it shares with Settings, today's spend, Claude Code
 * set-up, finishing the tour, and the settings, voice picker, browser-folder, pairing and Home calls the steps use.
 * Contains WalkthroughHost, WalkthroughSettings.
 */

import type { MicWatcher } from '../controls';
import type { HostBridge } from '../host-bridge';
import type { FoundBrain, PairOffer, PairOutcome } from '../shapes/pairing';

/**
 * The slice of the host's settings the steps read and write. Plain strings: the host
 * validates a patch itself (an unknown talk key is refused there).
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
    speed: number;
    microphoneId?: string | undefined;
    mouth?: string | undefined;
    ears?: string | undefined;
  };
}

export type WalkthroughHost = Pick<
  HostBridge,
  | 'keyStatus'
  | 'setKey'
  | 'setDailyLimit'
  | 'onBrainChanged'
  | 'openWalkthrough'
  | 'usageSummary'
  | 'setupOverview'
  | 'ttsState'
  | 'setTts'
  | 'playVoiceSample'
  | 'voiceDownload'
  | 'fetchVoice'
  | 'brainLink'
> & {
  /** Brains on the home network, by name and address. */
  discoverBrains(): Promise<FoundBrain[]>;
  /** Pairs with the brain a `tagalong://pair` link names; on success the desktop dials it. */
  pairWithLink(text: string): Promise<PairOutcome>;
  /** Makes a pairing code on this PC's brain, for another device to scan or type. */
  pairMake(): Promise<PairOffer>;
  /** Registers this PC's brain to start at logon, with network access on for other devices. */
  installBrainService(): Promise<{ ok: true } | { ok: false; detail: string }>;
  /**
   * Sets an expert up (install, then log in) with the person's press as the OK, Tagalong's own
   * Node included. Resolves when the brain took the job; progress comes through the overview.
   * Rejects with a short token when the brain refused it.
   */
  setupExpert(id: string): Promise<{ state?: string }>;
  /**
   * Connects an app by its registry id and the search query that found it; the brain shows its Allow card. Resolves once that card is up (the answer saves the app later);
   * rejects with a short token when it failed (for example `registry_unavailable`).
   */
  setupApp(id: string, query: string): Promise<{ state?: string }>;
  /** Marks the tour seen and closes its window. Only Finish and Skip (with a key) call it. */
  /** Marks the tour seen; closes the window unless `close` is false (the finish card stays up). */
  finishWalkthrough(options?: { close?: boolean }): Promise<void>;
  /** Opens the Anthropic Console key page in the browser. */
  openKeyPage(): Promise<void>;
  getSettings(): Promise<WalkthroughSettings>;
  /** A patch replaces each top-level object it names, so a step sends the whole object. */
  saveSettings(patch: Partial<WalkthroughSettings>): Promise<unknown>;
  listMicrophones(): Promise<{ id: string; label: string }[]>;
  /**
   * Reads the microphone's loudness (0..1) for step 5's meter until stop(). The sound itself
   * never leaves the host: only the level does. A failure to open is reported, not thrown.
   */
  watchMicLevel: MicWatcher;
  /** Where the browser add-on's folder is (step 7). */
  browserFolder(): Promise<{ path: string; exists: boolean }>;
  showBrowserFolder(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Opens Home (the finish card's Open Home). */
  openHome(): Promise<void>;
};
