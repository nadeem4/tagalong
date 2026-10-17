/** Tests for the launch record, brain readiness and the launch line. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pet, Settings, type SettingsPatch } from '@tagalong/protocol';
import { brainLine, brainReadiness, brainStatus, recordCleanClose, recordLaunch } from './launch';
import { providerChoices } from './provider-choices';

afterEach(() => vi.useRealTimers());

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

const pet = (providerId: string) =>
  Pet.parse({
    id: 'scout',
    name: 'Scout',
    avatar: '🐾',
    roleId: 'companion',
    model: 'haiku',
    providerId,
  });

describe('brainReadiness', () => {
  const ask = (
    providerId: string,
    signIn: () => Promise<'signed-in' | 'signed-out' | 'not-installed' | 'unknown'>,
    stored: string[] = [],
  ) =>
    brainReadiness({
      pet: pet(providerId),
      providers: providerChoices(new Set(stored)),
      signIn,
      budgetMs: 1_000,
    });

  it('reads the Claude sign-in for a Scout that thinks with it', async () => {
    expect(await ask('claude-code', async () => 'signed-in')).toBe('ready');
    expect(await ask('claude-code', async () => 'signed-out')).toBe('signed-out');
    expect(await ask('claude-code', async () => 'not-installed')).toBe('no-sign-in');
    expect(await ask('claude-code', async () => 'unknown')).toBe('unknown');
    expect(await ask('claude-code', () => Promise.reject(new Error('spawn failed')))).toBe(
      'unknown',
    );
  });

  it('reads whether a keyed Scout has its key, without running claude', async () => {
    const signIn = vi.fn(async () => 'signed-out' as const);
    expect(await ask('openrouter', signIn)).toBe('no-key');
    expect(await ask('openrouter', signIn, ['openrouter'])).toBe('ready');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('gives up on a slow sign-in check within the budget, so the greeting is not late', async () => {
    vi.useFakeTimers();
    const pending = ask('claude-code', () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBe('unknown');
  });
});

describe('brainLine', () => {
  it('is nothing when Scout can think, or could not be checked: the check-in has the line', () => {
    expect(brainLine('ready')).toBeNull();
    expect(brainLine('unknown')).toBeNull();
  });

  it('gives a status mark, never words in Scout’s voice, when Scout cannot think', () => {
    expect(brainLine('signed-out')).toEqual({ status: 'brain-signed-out' });
    expect(brainLine('no-sign-in')).toEqual({ status: 'brain-no-sign-in' });
    expect(brainLine('no-key')).toEqual({ status: 'brain-no-key' });
  });
});

describe('brainStatus', () => {
  it('names the brain mark for a brain that cannot think, or null', () => {
    expect(brainStatus('signed-out')).toBe('brain-signed-out');
    expect(brainStatus('no-sign-in')).toBe('brain-no-sign-in');
    expect(brainStatus('no-key')).toBe('brain-no-key');
    expect(brainStatus('ready')).toBeNull();
    expect(brainStatus('unknown')).toBeNull();
  });
});
