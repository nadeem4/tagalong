/** Tests for the host view, saving settings, Apply, keys and models. */

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
    listeningOff: vi.fn(),
    fromPanel: (event: unknown) => (event as { sender?: string }).sender === 'panel',
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

  it('carries the hotkey problem and no pairing token', async () => {
    const { invoke } = setup({ problem: 'the hotkey is taken' });
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view.elevenLabsKeyStored).toBe(false);
    expect(view.hotkeyError).toBe('the hotkey is taken');
    expect(view).not.toHaveProperty('pairingToken');
  });
});

describe('registerSettingsIpc: saveSettings', () => {
  it('settings set persists through the local store and returns the new settings', async () => {
    const { invoke, deps, settingsStore } = setup();
    const patch: SettingsPatch = { userName: 'Ada' };
    const saved = (await invoke(IPC.saveSettings, patch)) as Settings;
    expect(settingsStore.set).toHaveBeenCalledWith(patch);
    expect(saved.userName).toBe('Ada');
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

describe('registerSettingsIpc: applySettings', () => {
  const PANEL = { sender: 'panel' };

  it('refuses a card from any window but the bubble, and saves nothing', async () => {
    const { invokeWith, settingsStore, deps } = setup();
    await expect(
      invokeWith({ sender: 'home' }, IPC.applySettings, { userName: 'Sam' }),
    ).rejects.toThrow('only from the bubble');
    expect(settingsStore.set).not.toHaveBeenCalled();
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });

  it('re-checks the patch against the settings now, never trusting the renderer', async () => {
    const { invokeWith, settingsStore } = setup();
    await expect(
      invokeWith(PANEL, IPC.applySettings, {
        providerBaseUrls: { openrouter: 'https://evil.example' },
      }),
    ).rejects.toThrow();
    expect(settingsStore.set).not.toHaveBeenCalled();
  });

  it('saves a settings card to the local store', async () => {
    const { invokeWith, settingsStore, deps } = setup();
    await invokeWith(PANEL, IPC.applySettings, { userName: 'Sam' });
    expect(settingsStore.set).toHaveBeenCalledWith({ userName: 'Sam' });
    expect(deps.broadcast).toHaveBeenCalledOnce();
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });

  it('switches Always listening off through its own path, and saves the rest', async () => {
    const { invokeWith, settingsStore, deps } = setup();
    await invokeWith(PANEL, IPC.applySettings, { listening: { always: false }, greeting: false });
    expect(deps.listeningOff).toHaveBeenCalledTimes(1);
    expect(settingsStore.set).toHaveBeenCalledWith({ greeting: false });
  });

  it('never switches Always listening on', async () => {
    const { invokeWith, settingsStore, deps } = setup();
    await expect(
      invokeWith(PANEL, IPC.applySettings, { listening: { always: true } }),
    ).rejects.toThrow('Only you can switch Always listening on');
    expect(settingsStore.set).not.toHaveBeenCalled();
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });
});

describe('registerSettingsIpc: keys and models', () => {
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

  it('lists no models: the brain does not serve them yet', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.listModels, 'openrouter')).toEqual({
      models: [],
      source: 'fallback',
    });
  });

  it('says plainly that it could not test a key', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.checkKey, 'openrouter')).toEqual({
      ok: false,
      message: 'Tagalong’s engine isn’t running, so the key couldn’t be tested.',
    });
  });
});
