/** Tests for the launch record. */

import { describe, expect, it, vi } from 'vitest';
import { Settings, type SettingsPatch } from '@tagalong/protocol';
import { recordCleanClose, recordLaunch } from './launch';

function store(initial: Record<string, unknown> = {}) {
  let current = Settings.parse(initial);
  return {
    get: vi.fn(() => current),
    set: vi.fn((patch: SettingsPatch) => (current = Settings.parse({ ...current, ...patch }))),
    now: () => current,
  };
}

describe('recordLaunch', () => {
  it('reads what the last launch left, then marks this one open on this version', () => {
    const s = store({ closedCleanly: true, lastVersion: '0.4.0' });
    expect(recordLaunch(s, '0.5.0')).toEqual({ crashed: false, lastVersion: '0.4.0' });
    expect(s.now().closedCleanly).toBe(false);
    expect(s.now().lastVersion).toBe('0.5.0');
  });

  it('reads a launch that never closed cleanly as a crash', () => {
    expect(recordLaunch(store({ closedCleanly: false, lastVersion: '0.5.0' }), '0.5.0')).toEqual({
      crashed: true,
      lastVersion: '0.5.0',
    });
  });

  it('never reads a settings file from before the marker as a crash', () => {
    expect(recordLaunch(store({ welcome: { done: true } }), '0.5.0')).toEqual({
      crashed: false,
      lastVersion: null,
    });
  });

  it('never stops a launch when the settings file cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      get: () => Settings.parse({}),
      set: () => {
        throw new Error('EPERM');
      },
    };
    expect(recordLaunch(broken, '0.5.0')).toEqual({ crashed: false, lastVersion: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('recordCleanClose', () => {
  it('marks the close clean and remembers when', () => {
    const s = store({ closedCleanly: false });
    recordCleanClose(s, new Date('2026-10-14T18:00:00.000Z'));
    expect(s.now().closedCleanly).toBe(true);
    expect(s.now().lastClosedAt).toBe('2026-10-14T18:00:00.000Z');
  });

  it('does nothing without a store: a second instance quits before it has one', () => {
    expect(() => recordCleanClose(null, new Date())).not.toThrow();
  });
});
