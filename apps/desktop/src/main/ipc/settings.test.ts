/** Tests for the host view, saving settings, Apply, keys and models. */

import { describe, expect, it, vi } from 'vitest';
import { InMemorySecretStore } from '@tagalong/core';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import { ELEVENLABS_SECRET_KEY, providerChoices, secretKeyFor } from '../provider-choices';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerSettingsIpc } from './settings';

const ENGINE_SETTINGS: Settings = { ...SETTINGS_DEFAULTS, userName: 'Ada' } as Settings;
const STORED_SETTINGS: Settings = { ...SETTINGS_DEFAULTS };
const PET = { id: 'scout' };

function setup({ engineUp = true, problem = null as string | null } = {}) {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'settings.get': { settings: ENGINE_SETTINGS },
    'settings.set': { settings: ENGINE_SETTINGS },
    'pets.list': { pets: [PET] },
    'models.list': { models: ['m1'], source: 'live' },
    'providers.check': { ok: true },
  });
  const secrets = new InMemorySecretStore();
  const settingsStore = {
    get: vi.fn(() => STORED_SETTINGS),
    set: vi.fn((patch: SettingsPatch) => ({ ...STORED_SETTINGS, ...patch }) as Settings),
  };
  const deps = {
    host: () => (engineUp ? { client: engine.client, engine: { pairingToken: 'tok' } } : null),
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
  return { ...ipc, calls: engine.calls, secrets, settingsStore, deps };
}

describe('registerSettingsIpc: hostView', () => {
  it("shows the engine's settings, the pets, which keys are stored and the pairing token", async () => {
    const { invoke, secrets } = setup();
    await secrets.set(secretKeyFor('openrouter')!, 'sk');
    await secrets.set(ELEVENLABS_SECRET_KEY, 'el');
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view).toEqual({
      elevenLabsKeyStored: true,
      settings: ENGINE_SETTINGS,
      pets: [PET],
      providers: providerChoices(new Set(['openrouter'])),
      engineVersion: '1.2.3',
      platform: process.platform,
      pairingToken: 'tok',
    });
  });

  it('still opens with no engine: stored settings, no pets, no token, and the problem', async () => {
    const { invoke } = setup({ engineUp: false, problem: 'the engine is down' });
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view.settings).toBe(STORED_SETTINGS);
    expect(view.pets).toEqual([]);
    expect(view.elevenLabsKeyStored).toBe(false);
    expect(view.hotkeyError).toBe('the engine is down');
    expect(view).not.toHaveProperty('pairingToken');
  });
});

describe('registerSettingsIpc: saveSettings', () => {
  it('saves through the engine and tells every window', async () => {
    const { invoke, calls, deps } = setup();
    const patch: SettingsPatch = { userName: 'Ada' };
    expect(await invoke(IPC.saveSettings, patch)).toBe(ENGINE_SETTINGS);
    expect(calls).toEqual([['settings.set', { patch }]]);
    expect(deps.setSettings).toHaveBeenCalledWith(ENGINE_SETTINGS);
    expect(deps.broadcast).toHaveBeenCalledWith(ENGINE_SETTINGS);
    expect(deps.applyHotkeys).not.toHaveBeenCalled();
    expect(deps.configureRolling).not.toHaveBeenCalled();
  });

  it('saves to the file with no engine, and applies hotkeys and rolling memory now', async () => {
    const { invoke, calls, deps, settingsStore } = setup({ engineUp: false });
    const patch: SettingsPatch = {
      hotkeys: SETTINGS_DEFAULTS.hotkeys,
      rollingMemory: SETTINGS_DEFAULTS.rollingMemory,
    };
    const saved = (await invoke(IPC.saveSettings, patch)) as Settings;
    expect(settingsStore.set).toHaveBeenCalledWith(patch);
    expect(calls).toEqual([]);
    expect(deps.applyHotkeys).toHaveBeenCalledWith(saved);
    expect(deps.configureRolling).toHaveBeenCalledWith(saved.rollingMemory);
  });
});

describe('registerSettingsIpc: applySettings', () => {
  const PANEL = { sender: 'panel' };

  it('refuses a card from any window but the bubble, and saves nothing', async () => {
    const { invokeWith, calls, deps } = setup();
    await expect(
      invokeWith({ sender: 'office' }, IPC.applySettings, { userName: 'Sam' }),
    ).rejects.toThrow('only from the bubble');
    expect(calls).toEqual([]);
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });

  it('re-checks the patch against the settings now, never trusting the renderer', async () => {
    const { invokeWith, calls } = setup();
    await expect(
      invokeWith(PANEL, IPC.applySettings, {
        providerBaseUrls: { openrouter: 'https://evil.example' },
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([['settings.get', {}]]);
  });

  it('saves a settings card through the engine, marked as by talk for the privacy log', async () => {
    const { invokeWith, calls, deps } = setup();
    const patch: SettingsPatch = { userName: 'Sam' };
    await invokeWith(PANEL, IPC.applySettings, patch);
    expect(calls).toEqual([
      ['settings.get', {}],
      ['settings.set', { patch, byTalk: true }],
    ]);
    expect(deps.broadcast).toHaveBeenCalledWith(ENGINE_SETTINGS);
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });

  it('switches Always listening off through its own path, and saves the rest', async () => {
    const { invokeWith, calls, deps } = setup();
    await invokeWith(PANEL, IPC.applySettings, { listening: { always: false }, greeting: false });
    expect(deps.listeningOff).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ['settings.get', {}],
      ['settings.set', { patch: { greeting: false }, byTalk: true }],
    ]);
  });

  it('never switches Always listening on', async () => {
    const { invokeWith, calls, deps } = setup();
    await expect(
      invokeWith(PANEL, IPC.applySettings, { listening: { always: true } }),
    ).rejects.toThrow('Only you can switch Always listening on');
    expect(calls).toEqual([]);
    expect(deps.listeningOff).not.toHaveBeenCalled();
  });

  it('saves to the file with no engine', async () => {
    const { invokeWith, settingsStore } = setup({ engineUp: false });
    await invokeWith(PANEL, IPC.applySettings, { userName: 'Sam' });
    expect(settingsStore.set).toHaveBeenCalledWith({ userName: 'Sam' });
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

  it("lists a provider's models, or none with no engine", async () => {
    const up = setup();
    expect(await up.invoke(IPC.listModels, 'openrouter')).toEqual({
      models: ['m1'],
      source: 'live',
    });
    expect(up.calls).toEqual([['models.list', { providerId: 'openrouter' }]]);
    const down = setup({ engineUp: false });
    expect(await down.invoke(IPC.listModels, 'openrouter')).toEqual({
      models: [],
      source: 'fallback',
    });
  });
});

describe('registerSettingsIpc: checkKey', () => {
  it('asks the engine to test the key once', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.checkKey, 'openrouter')).toEqual({ ok: true });
    expect(calls).toContainEqual(['providers.check', { providerId: 'openrouter' }]);
  });

  it('says plainly that it could not test with no engine', async () => {
    const { invoke } = setup({ engineUp: false });
    expect(await invoke(IPC.checkKey, 'openrouter')).toEqual({
      ok: false,
      message: 'Tagalong’s engine isn’t running, so I couldn’t test the key.',
    });
  });
});
