import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import {
  AlwaysListening,
  LISTENING_GUARD_MS,
  listeningBlocked,
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

describe('startListeningGuard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks only while listening is on, and keeps the last answer when a listing fails', async () => {
    let active = false;
    const list = vi
      .fn()
      .mockResolvedValueOnce([win({ fullScreen: true })])
      .mockRejectedValueOnce(new Error('sight paused'))
      .mockResolvedValue([win({})]);
    const onBlocked = vi.fn();
    const stop = startListeningGuard({ active: () => active, list, onBlocked });
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    expect(list).not.toHaveBeenCalled();
    active = true;
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    await vi.advanceTimersByTimeAsync(LISTENING_GUARD_MS);
    expect(onBlocked.mock.calls).toEqual([[true], [false]]);
    stop();
  });
});
