import type { CaptureBlock } from '@tagalong/core';
import type { ContextSnapshot, Settings, SettingsPatch } from '@tagalong/protocol';
import type { HostBridge } from '@tagalong/ui';

/** Channel names, in one place so main and preload cannot drift apart. */
export const IPC = {
  ask: 'tagalong:ask',
  interrupt: 'tagalong:interrupt',
  listPets: 'tagalong:pets:list',
  turnEvent: 'tagalong:turn-event',
  getContext: 'tagalong:context:get',
  capture: 'tagalong:capture',
  contextEvent: 'tagalong:context-event',
  hostView: 'tagalong:host:view',
  saveSettings: 'tagalong:settings:save',
  saveApiKey: 'tagalong:secret:api-key',
  openSettings: 'tagalong:settings:open',
  hidePanel: 'tagalong:panel:hide',
  togglePanel: 'tagalong:panel:toggle',
  captureEvent: 'tagalong:capture-event',
  sightPauseEvent: 'tagalong:sight-pause-event',
  getSightPaused: 'tagalong:get-sight-paused',
  toggleSightPause: 'tagalong:toggle-sight-pause',
  hotkeyProblemEvent: 'tagalong:hotkey-problem-event',
} as const;

/**
 * What the host announces the moment it looks at the screen — or refuses to.
 *
 * Capture is never silent: the avatar badges every one of these, so the notice is sent on
 * every path that perceives anything, including a capture a pet's own tool asked for.
 */
export interface CaptureNotice {
  /** ISO instant of the attempt, so the badge and the tray tooltip agree on when. */
  at: string;
  /** Whether a screenshot was part of it. A selection read is not a screen capture. */
  screenshot: boolean;
  /** One sentence the panel can show as-is, written by the host. */
  message: string;
  /** Set when an exclusion rule refused the screenshot. Names the rule, nothing else. */
  blocked?: CaptureBlock;
  /**
   * Set when sight was paused, so nothing was read at all.
   *
   * Separate from `blocked` because the two are fixed differently: an exclusion by
   * editing a list, a pause by pressing a key.
   */
  paused?: boolean;
}

/** What the settings window needs to render. The key itself never comes back out. */
export interface HostView {
  settings: Settings;
  hasApiKey: boolean;
  engineVersion: string;
  /** Set when the global hotkey could not be registered, so settings can say why. */
  hotkeyError?: string;
}

/**
 * Host-only concerns, deliberately kept off `window.tagalong`.
 *
 * `window.tagalong` is exactly the HostBridge that @tagalong/ui knows how to consume;
 * anything specific to this host lives here instead, so a component can never grow a
 * dependency on something the Chrome host will not have.
 */
export interface TagalongHostApi {
  getContext(): Promise<ContextSnapshot | null>;
  onContext(handler: (snapshot: ContextSnapshot | null) => void): () => void;
  /** Fires on every capture the host makes, so the avatar can badge it and the panel can
   *  show why a capture was refused. */
  onCapture(handler: (notice: CaptureNotice) => void): () => void;
  /** The current pause state, for a window that opened after the last toggle. */
  getSightPaused(): Promise<boolean>;
  /** Fires whenever the user pauses or resumes sight, so the avatar can grey its eye. */
  onSightPause(handler: (paused: boolean) => void): () => void;
  /**
   * Fires when a hotkey fails to register, and again with null once it is fixed.
   *
   * A window that only read the problem on mount would keep showing it after the user
   * corrected the binding, which is the same lie as never showing it at all.
   */
  onHotkeyProblem(handler: (problem: string | null) => void): () => void;
  /**
   * Flips sight off or on, returning the state it moved to.
   *
   * The shipped surfaces are the hotkey and the tray item; this exists because a window
   * needs it too — settings will offer the toggle, and the smoke test drives the real
   * gate through it, which is the only check in the repo that fails when the gate is
   * left unwired.
   */
  toggleSightPause(): Promise<boolean>;
  getHostView(): Promise<HostView>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  saveApiKey(apiKey: string): Promise<void>;
  openSettings(): Promise<void>;
  hidePanel(): Promise<void>;
  togglePanel(): Promise<void>;
}

declare global {
  interface Window {
    tagalong: HostBridge;
    tagalongHost: TagalongHostApi;
  }
}
