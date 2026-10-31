/**
 * IPC for Settings: the host view every window reads, and saving settings. Reads and
 * writes the desktop's own settings file; the brain has no settings. Contains
 * registerSettingsIpc.
 */

import type { Settings, SettingsPatch } from '../../shared/settings';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import type { IpcHandle } from './handle';
import { localScout } from './scout';

interface SettingsIpcDeps {
  /** The desktop's own settings file. */
  settingsStore: () => { get(): Settings; set(patch: SettingsPatch): Settings };
  /** Why a hotkey failed, for Settings to say. */
  problem: () => string | null;
  version: () => string;
  setSettings: (settings: Settings) => void;
  applyHotkeys: (settings: Settings) => void;
  /** Tells the brain the voice setting (read aloud, voice, speed, mouth) as just saved. */
  applyVoice: (settings: Settings) => void;
  /** Sends the saved settings to every open window. */
  broadcast: (settings: Settings) => void;
}

/** Settings. */
export function registerSettingsIpc(handle: IpcHandle, deps: SettingsIpcDeps): void {
  const readSettings = (): Promise<Settings> => Promise.resolve(deps.settingsStore().get());

  handle(IPC.hostView, async (): Promise<HostView> => {
    const settings = await readSettings();
    const problem = deps.problem();
    return {
      settings,
      pets: [localScout()],
      appVersion: deps.version(),
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
    if (patch.voice !== undefined) deps.applyVoice(saved);
    // An open panel reads its keys and microphone from here, not a restart.
    deps.broadcast(saved);
    return Promise.resolve(saved);
  };

  handle(IPC.saveSettings, (_event, patch: SettingsPatch) => save(patch));
}
