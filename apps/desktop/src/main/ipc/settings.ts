/**
 * IPC for Settings: the host view every window reads, saving settings, the keys and the model
 * lists. Works with no engine, from the settings file. Contains registerSettingsIpc.
 */

import type { SecretStore } from '@tagalong/core';
import type { ProvidersCheckResult, Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { HostView, ModelList } from '../../shared/ipc';
import {
  ELEVENLABS_SECRET_KEY,
  providerChoices,
  secretKeyFor,
  storedKeys,
} from '../provider-choices';
import type { EngineCall, IpcHandle } from './handle';
import { applySettings } from './apply-settings';

export interface SettingsIpcDeps {
  /** The running engine, or null when it refused to boot. */
  host: () => { client: EngineCall; engine: { pairingToken: string } } | null;
  /** The settings file, which still works with no engine. */
  settingsStore: () => { get(): Settings; set(patch: SettingsPatch): Settings };
  secrets: () => SecretStore;
  /** Why a hotkey or the engine failed, for Settings to say. */
  problem: () => string | null;
  version: () => string;
  setSettings: (settings: Settings) => void;
  applyHotkeys: (settings: Settings) => void;
  refreshStrip: () => void;
  configureRolling: (rollingMemory: Settings['rollingMemory']) => void;
  /** Sends the saved settings to every open window. */
  broadcast: (settings: Settings) => void;
  /** Always listening's off path, the same as the bubble's switch (`IPC.setListening`). */
  listeningOff: () => void;
  /** Whether the call came from the bubble's window: the only one with a settings card. */
  fromPanel: (event: unknown) => boolean;
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
    const elevenLabsKey = await secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null);
    return {
      elevenLabsKeyStored: elevenLabsKey !== null && elevenLabsKey.length > 0,
      settings,
      pets,
      providers: providerChoices(stored),
      engineVersion: deps.version(),
      platform: process.platform,
      ...(host !== null ? { pairingToken: host.engine.pairingToken } : {}),
      ...(problem !== null ? { hotkeyError: problem } : {}),
    };
  });

  /** `byTalk`: applied from Scout's settings card, so the engine logs a "Changed by talk" row. */
  const save = async (patch: SettingsPatch, byTalk: boolean): Promise<Settings> => {
    const host = deps.host();
    const saved =
      host === null
        ? deps.settingsStore().set(patch)
        : (await host.client.call('settings.set', byTalk ? { patch, byTalk } : { patch })).settings;

    // Rebinding here is the whole point: a hotkey the user just typed has to work now,
    // not after a restart.
    deps.setSettings(saved);
    if (patch.hotkeys !== undefined) deps.applyHotkeys(saved);
    if (patch.hiddenPets !== undefined) deps.refreshStrip();
    // A new default pet: the desktop redraws on the pet it now shows.
    if (patch.defaultPetId !== undefined) deps.refreshStrip();
    // Rolling memory starts, stops or trims the moment the user saves, not after a restart.
    if (patch.rollingMemory !== undefined) deps.configureRolling(saved.rollingMemory);
    // An open panel reads its keys, microphone and the user's name from here, not a restart.
    deps.broadcast(saved);
    return saved;
  };

  handle(IPC.saveSettings, (_event, patch: SettingsPatch) => save(patch, false));

  // Apply on Scout's settings card: a click only. Always listening goes its own off path.
  // The patch is the renderer's, so it is checked again against the settings now.
  handle(IPC.applySettings, (event, patch: unknown) => {
    if (!deps.fromPanel(event)) {
      return Promise.reject(new Error('A settings card is applied only from the bubble.'));
    }
    return applySettings(patch, {
      current: readSettings,
      listeningOff: () => deps.listeningOff(),
      save: (rest) => save(rest, true),
    });
  });

  handle(IPC.saveApiKey, async (_event, providerId: string, apiKey: string) => {
    const secrets = deps.secrets();
    const secretKey = secretKeyFor(providerId);
    if (secretKey === undefined) throw new Error(`'${providerId}' does not take an API key`);
    if (apiKey.length === 0) await secrets.delete(secretKey);
    else await secrets.set(secretKey, apiKey);
  });

  handle(IPC.checkKey, async (_event, providerId: string): Promise<ProvidersCheckResult> => {
    const host = deps.host();
    if (host === null) {
      return { ok: false, message: 'Tagalong’s engine isn’t running, so I couldn’t test the key.' };
    }
    return host.client.call('providers.check', { providerId });
  });

  handle(IPC.listModels, async (_event, providerId: string): Promise<ModelList> => {
    const host = deps.host();
    // No engine, no list: the form still takes a typed model id.
    if (host === null) return { models: [], source: 'fallback' };
    return host.client.call('models.list', { providerId });
  });
}
