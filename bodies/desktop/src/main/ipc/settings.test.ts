/** Tests for the host view, saving settings and keys. */

import { describe, expect, it, vi } from 'vitest';
import { InMemorySecretStore } from '@tagalong/core';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import { ELEVENLABS_SECRET_KEY, providerChoices, secretKeyFor } from '../provider-choices';
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
  it('shows the local settings, the local Scout and which keys are stored', async () => {
    const { invoke, secrets } = setup();
    await secrets.set(secretKeyFor('openrouter')!, 'sk');
    await secrets.set(ELEVENLABS_SECRET_KEY, 'el');
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view).toEqual({
      elevenLabsKeyStored: true,
      settings: STORED_SETTINGS,
      pets: [localScout()],
      providers: providerChoices(new Set(['openrouter'])),
      engineVersion: '1.2.3',
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

describe('registerSettingsIpc: keys', () => {
  it('stores a key, and deletes it when the key is empty', async () => {
    const { invoke, secrets } = setup();
    const key = secretKeyFor('openrouter')!;
    await invoke(IPC.saveApiKey, 'openrouter', 'sk-1');
    expect(await secrets.get(key)).toBe('sk-1');
    await invoke(IPC.saveApiKey, 'openrouter', '');
    expect(await secrets.get(key)).toBeNull();
  });

  it('refuses a provider that takes no key', async () => {
    const { invoke } = setup();
    await expect(invoke(IPC.saveApiKey, 'nonsense', 'x')).rejects.toThrow(
      "'nonsense' does not take an API key",
    );
  });
});
