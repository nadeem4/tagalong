import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import type { Settings, SettingsPatch } from '@tagalong/protocol';
import { AlwaysListening } from '../always-listening';
import { applySettings } from './apply-settings';

function setup(on = true) {
  const listening = new AlwaysListening(on);
  const saved: SettingsPatch[] = [];
  const deps = {
    listeningOff: vi.fn(() => listening.set(false)),
    save: vi.fn((patch: SettingsPatch) => {
      saved.push(patch);
      return Promise.resolve({ ...SETTINGS_DEFAULTS, ...patch } as Settings);
    }),
  };
  return { listening, saved, deps };
}

describe('applySettings', () => {
  it('switches Always listening off through its own off path, and saves the rest', async () => {
    const { listening, saved, deps } = setup();
    await applySettings({ listening: { always: false }, userName: 'Sam' }, deps);
    expect(deps.listeningOff).toHaveBeenCalledTimes(1);
    expect(listening.state.on).toBe(false);
    expect(saved).toEqual([{ userName: 'Sam' }]);
  });

  it('only switches listening off when that is all the card changes', async () => {
    const { saved, deps } = setup();
    await applySettings({ listening: { always: false } }, deps);
    expect(deps.listeningOff).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([]);
  });

  it('only saves a patch without listening', async () => {
    const { saved, deps } = setup();
    const patch = { voice: { ...SETTINGS_DEFAULTS.voice, speed: 0.85 } };
    await applySettings(patch, deps);
    expect(deps.listeningOff).not.toHaveBeenCalled();
    expect(saved).toEqual([patch]);
  });

  it('never switches Always listening on, and saves nothing then', async () => {
    const { listening, saved, deps } = setup(false);
    await expect(
      applySettings({ listening: { always: true }, userName: 'Sam' }, deps),
    ).rejects.toThrow('Only you can switch Always listening on');
    expect(listening.state.on).toBe(false);
    expect(saved).toEqual([]);
  });

  it('refuses a patch that is not a settings patch', async () => {
    const { saved, deps } = setup();
    await expect(applySettings({ voice: { speed: 9 } }, deps)).rejects.toThrow();
    expect(saved).toEqual([]);
  });
});
