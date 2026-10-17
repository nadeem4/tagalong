/** Tests for the keep-an-eye timer. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import {
  KEEP_AN_EYE_INTERVAL_MS,
  fullScreenAsSeen,
  keepAnEyeAllowed,
  startKeepAnEye,
} from './keep-an-eye';

const window: WindowEntry = {
  id: 'w-1',
  processName: 'Code.exe',
  title: 'parser.ts - Code',
  state: 'foreground',
  browser: false,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('keepAnEyeAllowed', () => {
  it('runs in the real app', () => {
    expect(keepAnEyeAllowed({})).toBe(true);
  });

  it('stays off under fake providers, so e2e never meets a remark it did not ask for', () => {
    expect(keepAnEyeAllowed({ TAGALONG_FAKE_PROVIDERS: '1' })).toBe(false);
    expect(keepAnEyeAllowed({ TAGALONG_FAKE_PROVIDERS: '1', TAGALONG_KEEP_AN_EYE: '1' })).toBe(
      true,
    );
  });
});

describe('fullScreenAsSeen', () => {
  const full: WindowEntry = { ...window, fullScreen: true };

  it('keeps full screen as listed in the real app: a check-in waits behind it', () => {
    expect(fullScreenAsSeen([full], {})).toEqual([full]);
  });

  it('drops it under fake providers, so the CI desktop never silences an e2e check-in', () => {
    expect(fullScreenAsSeen([full, window], { TAGALONG_FAKE_PROVIDERS: '1' })).toEqual([
      window,
      window,
    ]);
  });
});

describe('startKeepAnEye', () => {
  it('sends the window titles every few seconds while it is on', async () => {
    const sent: WindowEntry[][] = [];
    const state = { on: true };
    const stop = startKeepAnEye({
      enabled: () => state.on,
      list: () => Promise.resolve([window]),
      send: (windows) => {
        sent.push(windows);
        return Promise.resolve();
      },
    });
    await vi.advanceTimersByTimeAsync(KEEP_AN_EYE_INTERVAL_MS * 2);
    expect(sent).toEqual([[window], [window]]);

    state.on = false;
    await vi.advanceTimersByTimeAsync(KEEP_AN_EYE_INTERVAL_MS * 3);
    expect(sent).toHaveLength(2);

    state.on = true;
    stop();
    await vi.advanceTimersByTimeAsync(KEEP_AN_EYE_INTERVAL_MS * 3);
    expect(sent).toHaveLength(2);
  });

  it('lists nothing at all while it is off', async () => {
    const list = vi.fn(() => Promise.resolve([window]));
    startKeepAnEye({ enabled: () => false, list, send: () => Promise.resolve() })();
    await vi.advanceTimersByTimeAsync(KEEP_AN_EYE_INTERVAL_MS * 3);
    expect(list).not.toHaveBeenCalled();
  });

  it('shrugs off a failed listing, a paused sight included, and tries again next time', async () => {
    const sent: WindowEntry[][] = [];
    let calls = 0;
    const stop = startKeepAnEye({
      enabled: () => true,
      list: () => (calls++ === 0 ? Promise.reject(new Error('paused')) : Promise.resolve([window])),
      send: (windows) => {
        sent.push(windows);
        return Promise.resolve();
      },
    });
    await vi.advanceTimersByTimeAsync(KEEP_AN_EYE_INTERVAL_MS * 2);
    expect(sent).toEqual([[window]]);
    stop();
  });
});
