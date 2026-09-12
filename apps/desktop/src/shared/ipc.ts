import type { ContextSnapshot, Settings, SettingsPatch } from '@tagalong/protocol';
import type { HostBridge } from '@tagalong/ui';

/** Channel names, in one place so main and preload cannot drift apart. */
export const IPC = {
  ask: 'tagalong:ask',
  interrupt: 'tagalong:interrupt',
  listPets: 'tagalong:pets:list',
  turnEvent: 'tagalong:turn-event',
  getContext: 'tagalong:context:get',
  contextEvent: 'tagalong:context-event',
  hostView: 'tagalong:host:view',
  saveSettings: 'tagalong:settings:save',
  saveApiKey: 'tagalong:secret:api-key',
  openSettings: 'tagalong:settings:open',
  hidePanel: 'tagalong:panel:hide',
  togglePanel: 'tagalong:panel:toggle',
} as const;

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
