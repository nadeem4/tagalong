/**
 * Tests for Always listening's state, its pauses, the call and full-screen guard, and saving it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, WindowEntry } from '@tagalong/protocol';
import {
  AlwaysListening,
  LISTENING_GUARD_MS,
  listeningBlocked,
  listeningPaused,
  saveListening,
  startListeningGuard,
} from './always-listening';
import type { EngineCall } from './ipc/handle';

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
    expect(new AlwaysListening().state).toEqual({ on: false, paused: false });
    expect(new AlwaysListening(true).state).toEqual({ on: true, paused: false });
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
      { on: false, paused: true },
      { on: true, paused: true },
      { on: true, paused: false },
    ]);
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
  const hostWith = (call: ReturnType<typeof vi.fn>) => ({
    client: { call } as unknown as EngineCall,
  });

  it('saves only a change of on, through the engine', async () => {
    const call = vi.fn(async () => ({ settings: saved(true) }));
    const onSaved = vi.fn();
    const save = saveListening({
      saved: false,
      host: () => hostWith(call),
      settingsStore: () => ({ set: vi.fn() }),
      onSaved,
    });
    save({ on: false, paused: true });
    save({ on: true, paused: false });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved(true)));
    expect(call.mock.calls).toEqual([['settings.set', { patch: { listening: { always: true } } }]]);
    save({ on: true, paused: true });
    expect(call).toHaveBeenCalledOnce();
  });

  /** Saves that wait until the test answers them, one by one. */
  function deferredSaves() {
    const answers: (() => void)[] = [];
    const call = vi.fn(
      (_method: string, params: { patch: { listening: { always: boolean } } }) =>
        new Promise((resolve) =>
          answers.push(() => resolve({ settings: saved(params.patch.listening.always) })),
        ),
    );
    return { call, answer: () => answers.shift()?.() };
  }

  it.each([
    [false, [true, false]],
    [true, [false, true]],
  ])(
    'switched twice before the first save is done (saved %s), the last choice is the one saved',
    async (start, choices) => {
      const { call, answer } = deferredSaves();
      const onSaved = vi.fn();
      const save = saveListening({
        saved: start,
        host: () => hostWith(call as unknown as ReturnType<typeof vi.fn>),
        settingsStore: () => ({ set: vi.fn() }),
        onSaved,
      });
      for (const on of choices) save({ on, paused: false });
      // One save at a time: the second waits for the first.
      expect(call).toHaveBeenCalledOnce();
      answer();
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      answer();
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
      expect(call.mock.calls.map(([, params]) => params.patch.listening.always)).toEqual(choices);
      expect(onSaved).toHaveBeenLastCalledWith(saved(start));
      // Saved now: a change that is no change saves nothing.
      save({ on: start, paused: true });
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it('saves to the settings file when the engine is not running', () => {
    const set = vi.fn(() => saved(false));
    const onSaved = vi.fn();
    const save = saveListening({
      saved: true,
      host: () => null,
      settingsStore: () => ({ set }),
      onSaved,
    });
    save({ on: false, paused: false });
    expect(set).toHaveBeenCalledWith({ listening: { always: false } });
    expect(onSaved).toHaveBeenCalledWith(saved(false));
  });

  it('tries again at the next change after a save failed, so switching off is never lost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('engine busy'))
      .mockResolvedValue({ settings: saved(false) });
    const set = vi.fn(() => {
      throw new Error('disk full');
    });
    const onSaved = vi.fn();
    let host: ReturnType<typeof hostWith> | null = null;
    const save = saveListening({
      saved: true,
      host: () => host,
      settingsStore: () => ({ set }),
      onSaved,
    });
    save({ on: false, paused: false });
    expect(warn).toHaveBeenCalledOnce();
    host = hostWith(call);
    save({ on: false, paused: true });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    save({ on: false, paused: false });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved(false)));
    expect(call).toHaveBeenCalledTimes(2);
    save({ on: false, paused: true });
    expect(call).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
