/** Tests for the host view, saving settings and keys. */

import { describe, expect, it, vi } from 'vitest';
import { InMemorySecretStore } from '../test-support/in-memory-secret-store';
import { SETTINGS_DEFAULTS } from '../../shared/settings';
import type { Settings, SettingsPatch } from '../../shared/settings';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import { ELEVENLABS_SECRET_KEY } from '../secret-store';
import { fakeIpc } from './fake-ipc';
import { localScout } from './scout';
import { registerSettingsIpc } from './settings';

const STORED_SETTINGS: Settings = { ...SETTINGS_DEFAULTS };

function setup({ problem = null as string | null } = {}) {
  const ipc = fakeIpc();
  const secrets = new InMemorySecretStore();
  const settingsStore = {
    get: vi.fn(() => STORED_SETTINGS),
    set: vi.fn((patch: SettingsPatch) => ({ ...STORED_SETTINGS, ...patch }) as Settings),
  };
  const deps = {
    settingsStore: () => settingsStore,
    secrets: () => secrets,
    problem: () => problem,
    version: () => '1.2.3',
    setSettings: vi.fn(),
    applyHotkeys: vi.fn(),
    configureRolling: vi.fn(),
    broadcast: vi.fn(),
  };
  registerSettingsIpc(ipc.handle, deps);
  return { ...ipc, secrets, settingsStore, deps };
}

describe('registerSettingsIpc: hostView', () => {
  it('shows the local settings, the local Scout and whether the voice key is stored', async () => {
    const { invoke, secrets } = setup();
    await secrets.set(ELEVENLABS_SECRET_KEY, 'el');
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view).toEqual({
      elevenLabsKeyStored: true,
      settings: STORED_SETTINGS,
      pets: [localScout()],
      appVersion: '1.2.3',
      platform: process.platform,
    });
  });

  it('carries the hotkey problem', async () => {
    const { invoke } = setup({ problem: 'the hotkey is taken' });
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view.elevenLabsKeyStored).toBe(false);
    expect(view.hotkeyError).toBe('the hotkey is taken');
  });
});

describe('registerSettingsIpc: saveSettings', () => {
  it('settings set persists through the local store and returns the new settings', async () => {
    const { invoke, deps, settingsStore } = setup();
    const patch: SettingsPatch = { listening: { always: true } };
    const saved = (await invoke(IPC.saveSettings, patch)) as Settings;
    expect(settingsStore.set).toHaveBeenCalledWith(patch);
    expect(saved.listening.always).toBe(true);
    expect(deps.setSettings).toHaveBeenCalledWith(saved);
    expect(deps.broadcast).toHaveBeenCalledWith(saved);
    expect(deps.applyHotkeys).not.toHaveBeenCalled();
    expect(deps.configureRolling).not.toHaveBeenCalled();
  });

  it('applies hotkeys and rolling memory now', async () => {
    const { invoke, deps } = setup();
    const patch: SettingsPatch = {
      hotkeys: SETTINGS_DEFAULTS.hotkeys,
      rollingMemory: SETTINGS_DEFAULTS.rollingMemory,
    };
    const saved = (await invoke(IPC.saveSettings, patch)) as Settings;
    expect(deps.applyHotkeys).toHaveBeenCalledWith(saved);
    expect(deps.configureRolling).toHaveBeenCalledWith(saved.rollingMemory);
  });
});

describe('registerSettingsIpc: the ElevenLabs key', () => {
  it('stores the key, and deletes it when the key is empty', async () => {
    const { invoke, secrets } = setup();
    await invoke(IPC.saveElevenLabsKey, 'el-1');
    expect(await secrets.get(ELEVENLABS_SECRET_KEY)).toBe('el-1');
    await invoke(IPC.saveElevenLabsKey, '');
    expect(await secrets.get(ELEVENLABS_SECRET_KEY)).toBeNull();
  });

  it('has no brain keys: no providers in the host view and no generic key channel', async () => {
    const { invoke, channels } = setup();
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view).not.toHaveProperty('providers');
    expect(Object.keys(IPC)).not.toContain('saveApiKey');
    expect(channels()).toContain(IPC.saveElevenLabsKey);
  });
});
