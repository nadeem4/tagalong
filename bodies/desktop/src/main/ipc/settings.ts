/**
 * IPC for Settings: the host view every window reads, saving settings and the voice key. Reads and
 * writes the desktop's own settings file; the brain has no settings. Contains
 * registerSettingsIpc.
 */

import type { SecretStore } from '../secret-store';
import type { Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import { ELEVENLABS_SECRET_KEY } from '../secret-store';
import type { IpcHandle } from './handle';
import { localScout } from './scout';

export interface SettingsIpcDeps {
  /** The desktop's own settings file. */
  settingsStore: () => { get(): Settings; set(patch: SettingsPatch): Settings };
  secrets: () => SecretStore;
  /** Why a hotkey failed, for Settings to say. */
  problem: () => string | null;
  version: () => string;
  setSettings: (settings: Settings) => void;
  applyHotkeys: (settings: Settings) => void;
  configureRolling: (rollingMemory: Settings['rollingMemory']) => void;
  /** Sends the saved settings to every open window. */
  broadcast: (settings: Settings) => void;
}

/** Settings and the ElevenLabs key. */
export function registerSettingsIpc(handle: IpcHandle, deps: SettingsIpcDeps): void {
  const readSettings = (): Promise<Settings> => Promise.resolve(deps.settingsStore().get());

  handle(IPC.hostView, async (): Promise<HostView> => {
    const secrets = deps.secrets();
    const settings = await readSettings();
    const problem = deps.problem();
    const elevenLabsKey = await secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null);
    return {
      elevenLabsKeyStored: elevenLabsKey !== null && elevenLabsKey.length > 0,
      settings,
      pets: [localScout()],
      engineVersion: deps.version(),
      platform: process.platform,
      ...(problem !== null ? { hotkeyError: problem } : {}),
    };
  });

  const save = (patch: SettingsPatch): Promise<Settings> => {
    const saved = deps.settingsStore().set(patch);

    // Rebinding here is the whole point: a hotkey the user just typed has to work now,
    // not after a restart.
    deps.setSettings(saved);
    if (patch.hotkeys !== undefined) deps.applyHotkeys(saved);
    // Rolling memory starts, stops or trims the moment the user saves, not after a restart.
    if (patch.rollingMemory !== undefined) deps.configureRolling(saved.rollingMemory);
    // An open panel reads its keys and microphone from here, not a restart.
    deps.broadcast(saved);
    return Promise.resolve(saved);
  };

  handle(IPC.saveSettings, (_event, patch: SettingsPatch) => save(patch));

  // An empty key deletes the stored one.
  handle(IPC.saveElevenLabsKey, async (_event, apiKey: string) => {
    const secrets = deps.secrets();
    if (apiKey.length === 0) await secrets.delete(ELEVENLABS_SECRET_KEY);
    else await secrets.set(ELEVENLABS_SECRET_KEY, apiKey);
  });
}
