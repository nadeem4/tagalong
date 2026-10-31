/** Tests for the host view, and saving settings. */

import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '../../shared/settings';
import type { Settings, SettingsPatch } from '../../shared/settings';
import { IPC } from '../../shared/ipc';
import type { HostView } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { localScout } from './scout';
import { registerSettingsIpc } from './settings';

const STORED_SETTINGS: Settings = { ...SETTINGS_DEFAULTS };

function setup({ problem = null as string | null } = {}) {
  const ipc = fakeIpc();
  const settingsStore = {
    get: vi.fn(() => STORED_SETTINGS),
    set: vi.fn((patch: SettingsPatch) => ({ ...STORED_SETTINGS, ...patch }) as Settings),
  };
  const deps = {
    settingsStore: () => settingsStore,
    problem: () => problem,
    version: () => '1.2.3',
    setSettings: vi.fn(),
    applyHotkeys: vi.fn(),
    broadcast: vi.fn(),
  };
  registerSettingsIpc(ipc.handle, deps);
  return { ...ipc, settingsStore, deps };
}

describe('registerSettingsIpc: hostView', () => {
  it('shows the local settings and the local Scout', async () => {
    const { invoke } = setup();
    const view = (await invoke(IPC.hostView)) as HostView;
    expect(view).toEqual({
      settings: STORED_SETTINGS,
      pets: [localScout()],
      appVersion: '1.2.3',
      platform: process.platform,
    });
  });

  it('carries the hotkey problem', async () => {
    const { invoke } = setup({ problem: 'the hotkey is taken' });
    const view = (await invoke(IPC.hostView)) as HostView;
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
  });

  it('applies hotkeys now', async () => {
    const { invoke, deps } = setup();
    const patch: SettingsPatch = { hotkeys: SETTINGS_DEFAULTS.hotkeys };
    const saved = (await invoke(IPC.saveSettings, patch)) as Settings;
    expect(deps.applyHotkeys).toHaveBeenCalledWith(saved);
  });
});
