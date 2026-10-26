/**
 * Tests for Always listening's state, its pauses, the call and full-screen guard, and saving it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, SettingsPatch, WindowEntry } from '@tagalong/protocol';
import {
  AlwaysListening,
  LISTENING_GUARD_MS,
  listeningBlocked,
  listeningPaused,
  saveListening,
  startListeningGuard,
} from './always-listening';

const win = (change: Partial<WindowEntry>): WindowEntry => ({
  id: '1',
  title: 'notes.md - Code',
  processName: 'Code.exe',
  state: 'foreground',
  browser: false,
  ...change,
});

describe('AlwaysListening', () => {
  it('starts from the saved setting', () => {
    expect(new AlwaysListening().state).toEqual({ on: false, paused: false, followUp: false });
    expect(new AlwaysListening(true).state).toEqual({ on: true, paused: false, followUp: false });
  });

  it('tells listeners only of real changes', () => {
    const listening = new AlwaysListening();
    const seen: unknown[] = [];
    listening.onChange((state) => seen.push(state));
    listening.setPaused(true);
    listening.set(true);
    listening.set(true);
    listening.setPaused(false);
    expect(seen).toEqual([
      { on: false, paused: true, followUp: false },
      { on: true, paused: true, followUp: false },
      { on: true, paused: false, followUp: false },
    ]);
  });

  it('holds the follow-up window only while listening is on and not paused', () => {
    const listening = new AlwaysListening();
    listening.setFollowUp(true);
    expect(listening.state.followUp).toBe(false);
    listening.set(true);
    listening.setFollowUp(true);
    expect(listening.state).toEqual({ on: true, paused: false, followUp: true });
    listening.setPaused(true);
    expect(listening.state.followUp).toBe(false);
    listening.setPaused(false);
    listening.setFollowUp(true);
    listening.set(false);
    expect(listening.state).toEqual({ on: false, paused: false, followUp: false });
    listening.set(true);
    listening.setFollowUp(true);
    listening.setFollowUp(false);
    expect(listening.state.followUp).toBe(false);
  });
});

describe('listeningBlocked', () => {
  it('blocks during a call and in full screen, not otherwise', () => {
    expect(listeningBlocked([win({ processName: 'ms-teams.exe', title: 'Standup' })])).toBe(true);
    expect(
      listeningBlocked([win({ processName: 'chrome.exe', title: 'Meet - abc-defg-hij' })]),
    ).toBe(true);
    expect(listeningBlocked([win({ fullScreen: true })])).toBe(true);
    expect(
      listeningBlocked([win({}), win({ id: '2', processName: 'zoom.exe', state: 'background' })]),
    ).toBe(false);
    expect(listeningBlocked([])).toBe(false);
  });
});

describe('listeningPaused', () => {
  it('pauses for a call or full screen, and while the pets are hidden: the mark is then never out of sight', () => {
    const why = { blocked: false, petsShown: true, setupOpen: false };
    expect(listeningPaused(why)).toBe(false);
    expect(listeningPaused({ ...why, blocked: true })).toBe(true);
    expect(listeningPaused({ ...why, petsShown: false })).toBe(true);
    expect(listeningPaused({ ...why, blocked: true, petsShown: false })).toBe(true);
  });

  it('pauses while setup is open: setup has the mic to itself', () => {
    expect(listeningPaused({ blocked: false, petsShown: true, setupOpen: true })).toBe(true);
    expect(listeningPaused({ blocked: false, petsShown: true, setupOpen: false })).toBe(false);
  });
});

describe('startListeningGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks only while listening is on, and keeps the last answer when a listing fails', async () => {
    const listening = new AlwaysListening();
    const list = vi
      .fn()
      .mockResolvedValueOnce([win({ fullScreen: true })])
      .mockRejectedValueOnce(new Error('sight paused'))
      .mockResolvedValue([win({})]);
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ listening, list, onBlocked });
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    expect(list).not.toHaveBeenCalled();
    listening.set(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    expect(onBlocked.mock.calls).toEqual([[true], [false]]);
    stop();
  });

  it('checks the front window at once when switched on, so the mic never opens during a call', async () => {
    const listening = new AlwaysListening();
    const list = vi.fn().mockResolvedValue([win({ processName: 'ms-teams.exe' })]);
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ listening, list, onBlocked });
    listening.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked.mock.calls).toEqual([[true]]);
    stop();
  });

  it('checks at once at launch when listening was left on', async () => {
    const list = vi.fn().mockResolvedValue([win({ fullScreen: true })]);
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ listening: new AlwaysListening(true), list, onBlocked });
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked.mock.calls).toEqual([[true]]);
    stop();
  });

  it('forgets its answer when switched off, so switching on during the same call pauses again', async () => {
    const listening = new AlwaysListening(true);
    const list = vi.fn().mockResolvedValue([win({ fullScreen: true })]);
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ listening, list, onBlocked });
    await vi.advanceTimersByTimeAsync(0);
    listening.set(false);
    expect(onBlocked.mock.calls).toEqual([[true], [false]]);
    listening.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked.mock.calls).toEqual([[true], [false], [true]]);
    stop();
  });

  it('logs one line when it pauses, with the reason and the app, and one when it resumes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const list = vi
        .fn()
        .mockResolvedValueOnce([win({ fullScreen: true, title: 'my private doc' })])
        .mockResolvedValueOnce([win({ fullScreen: true })])
        .mockResolvedValueOnce([win({ processName: 'ms-teams.exe' })])
        .mockResolvedValue([win({})]);
      const stop = startListeningGuard({
        listening: new AlwaysListening(true),
        list,
        onBlocked: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
      await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
      await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
      expect(warn.mock.calls).toEqual([
        ['[listening] paused: a full-screen window in front (Code.exe)'],
        ['[listening] resumed'],
      ]);
      // The title never reaches the log.
      expect(JSON.stringify(warn.mock.calls)).not.toContain('my private doc');
      stop();
    } finally {
      warn.mockRestore();
    }
  });

  it('names a call app as the reason when one is in front', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const list = vi.fn().mockResolvedValue([win({ processName: 'ms-teams.exe' })]);
      const stop = startListeningGuard({
        listening: new AlwaysListening(true),
        list,
        onBlocked: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(warn.mock.calls).toEqual([['[listening] paused: a call app in front (ms-teams.exe)']]);
      stop();
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores a listing that comes back after listening was switched off', async () => {
    let answer!: (windows: WindowEntry[]) => void;
    const listening = new AlwaysListening(true);
    const list = vi.fn(() => new Promise<WindowEntry[]>((resolve) => (answer = resolve)));
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ listening, list, onBlocked });
    listening.set(false);
    answer([win({ fullScreen: true })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked).not.toHaveBeenCalled();
    stop();
  });
});

describe('saveListening', () => {
  const saved = (always: boolean) => ({ listening: { always } }) as unknown as Settings;

  it('saves only a change of on, to the settings file', () => {
    const set = vi.fn((patch: SettingsPatch) => saved(patch.listening?.always ?? false));
    const onSaved = vi.fn();
    const save = saveListening({ saved: false, settingsStore: () => ({ set }), onSaved });
    save({ on: false, paused: true, followUp: false });
    expect(set).not.toHaveBeenCalled();
    save({ on: true, paused: false, followUp: false });
    expect(set.mock.calls).toEqual([[{ listening: { always: true } }]]);
    expect(onSaved).toHaveBeenCalledWith(saved(true));
    save({ on: true, paused: true, followUp: false });
    expect(set).toHaveBeenCalledOnce();
  });

  it('tries again at the next change after a save failed, so switching off is never lost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const set = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      })
      .mockReturnValue(saved(false));
    const onSaved = vi.fn();
    const save = saveListening({ saved: true, settingsStore: () => ({ set }), onSaved });
    save({ on: false, paused: false, followUp: false });
    expect(warn).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    save({ on: false, paused: true, followUp: false });
    expect(onSaved).toHaveBeenCalledWith(saved(false));
    expect(set).toHaveBeenCalledTimes(2);
    save({ on: false, paused: false, followUp: false });
    expect(set).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
