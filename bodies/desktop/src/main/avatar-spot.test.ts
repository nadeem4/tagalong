/** Tests for saveAvatarSpot: Scout's dragged position reaches the settings file and the live settings. */

import { describe, expect, it, vi } from 'vitest';
import type { Settings, SettingsPatch } from '../shared/settings';
import { SETTINGS_DEFAULTS } from '../shared/settings';
import { saveAvatarSpot } from './avatar-spot';

describe('saveAvatarSpot', () => {
  it('writes the spot to the settings store and hands the saved settings on', () => {
    const set = vi.fn((patch: SettingsPatch) => ({ ...SETTINGS_DEFAULTS, ...patch }) as Settings);
    const onSaved = vi.fn();
    saveAvatarSpot({ set }, { x: 10, y: 20 }, onSaved);
    expect(set).toHaveBeenCalledWith({ avatar: { x: 10, y: 20 } });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ avatar: { x: 10, y: 20 } }));
  });

  it('does not throw when the store cannot write', () => {
    const set = vi.fn(() => {
      throw new Error('disk full');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => saveAvatarSpot({ set }, { x: 1, y: 2 }, vi.fn())).not.toThrow();
    warn.mockRestore();
  });
});
