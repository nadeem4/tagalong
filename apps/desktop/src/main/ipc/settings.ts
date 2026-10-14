import { WATCH_MODEL_DEFAULTS } from '@tagalong/core';
import type { SecretStore } from '@tagalong/core';
import type { Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { HostView, ModelList } from '../../shared/ipc';
import { ELEVENLABS_SECRET_KEY, providerChoices, secretKeyFor, storedKeys } from '../provider-choices';
import type { EngineCall, IpcHandle } from './handle';

export interface SettingsIpcDeps {
  /** The running engine, or null when it refused to boot. */
  host: () => { client: EngineCall; engine: { pairingToken: string } } | null;
  /** The settings file, which still works with no engine. */
  settingsStore: () => { get(): Settings; set(patch: SettingsPatch): Settings };
  secrets: () => SecretStore;
  /** Why a hotkey or the engine failed, for Settings to say. */
  problem: () => string | null;
  /** The unpacked Chrome extension's folder, when it is on this machine. */
  extensionFolder: () => string | undefined;
  version: () => string;
  setSettings: (settings: Settings) => void;
  applyHotkeys: (settings: Settings) => void;
  refreshStrip: () => void;
  configureRolling: (rollingMemory: Settings['rollingMemory']) => void;
  /** Sends the saved settings to every open window. */
  broadcast: (settings: Settings) => void;
}

/** Settings, the keys, and the model lists. */
export function registerSettingsIpc(handle: IpcHandle, deps: SettingsIpcDeps): void {
  /** Settings still work with no engine, which is the whole point of the degraded mode. */
  const readSettings = async (): Promise<Settings> => {
    const host = deps.host();
    if (host === null) return deps.settingsStore().get();
    return (await host.client.call('settings.get', {})).settings;
  };

  handle(IPC.hostView, async (): Promise<HostView> => {
    const secrets = deps.secrets();
    const settings = await readSettings();
    const stored = await storedKeys(secrets);
    // Pets live in the engine's database; with no engine the form shows keys and URLs
    // only, which is exactly what someone fixing a failed boot needs.
    const host = deps.host();
    const pets = host === null ? [] : (await host.client.call('pets.list', {})).pets;
    const problem = deps.problem();
    const folder = deps.extensionFolder();
    const elevenLabsKey = await secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null);
    return {
      elevenLabsKeyStored: elevenLabsKey !== null && elevenLabsKey.length > 0,
      settings,
      pets,
      providers: providerChoices(stored),
      engineVersion: deps.version(),
      watchModelDefaults: { ...WATCH_MODEL_DEFAULTS },
      platform: process.platform,
      ...(folder !== undefined ? { extensionFolder: folder } : {}),
      ...(host !== null ? { pairingToken: host.engine.pairingToken } : {}),
      ...(problem !== null ? { hotkeyError: problem } : {}),
    };
  });

  handle(IPC.saveSettings, async (_event, patch: SettingsPatch): Promise<Settings> => {
    const host = deps.host();
    const saved =
      host === null
        ? deps.settingsStore().set(patch)
        : (await host.client.call('settings.set', { patch })).settings;

    // Rebinding here is the whole point: a hotkey the user just typed has to work now,
    // not after a restart.
    deps.setSettings(saved);
    if (patch.hotkeys !== undefined) deps.applyHotkeys(saved);
    if (patch.hiddenPets !== undefined) deps.refreshStrip();
    // Home's Desktop pet control: the desktop redraws on the pet it now shows.
    if (patch.defaultPetId !== undefined) deps.refreshStrip();
    // Rolling memory starts, stops or trims the moment the user saves, not after a restart.
    if (patch.rollingMemory !== undefined) deps.configureRolling(saved.rollingMemory);
    // An open panel reads its keys, microphone and the user's name from here, not a restart.
    deps.broadcast(saved);
    return saved;
  });

  handle(IPC.saveApiKey, async (_event, providerId: string, apiKey: string) => {
    const secrets = deps.secrets();
    const secretKey = secretKeyFor(providerId);
    if (secretKey === undefined) throw new Error(`'${providerId}' does not take an API key`);
    if (apiKey.length === 0) await secrets.delete(secretKey);
    else await secrets.set(secretKey, apiKey);
  });

  handle(IPC.listModels, async (_event, providerId: string): Promise<ModelList> => {
    const host = deps.host();
    // No engine, no list: the form still takes a typed model id.
    if (host === null) return { models: [], source: 'fallback' };
    return host.client.call('models.list', { providerId });
  });
}
