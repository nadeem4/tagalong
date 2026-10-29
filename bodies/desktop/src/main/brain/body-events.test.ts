/**
 * Tests for the desktop's two body events: back (after a long idle) and focus (the front
 * window changed). Fake timers; the clock is injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import { AWAY_AFTER_MS } from '../presence';
import { createBackSender, frontWindow, startFocusWatch } from './body-events';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createBackSender', () => {
  it('sends back with the whole seconds away', () => {
    let t = 1_000;
    const send = vi.fn();
    const onChange = createBackSender({ send, now: () => t, idleMs: () => 0 });
    onChange('away');
    t += 301_900;
    onChange('back');
    expect(send).toHaveBeenCalledWith('back', { idle_seconds: 301 });
  });

  it('sends nothing for a short away, such as a brief screen lock', () => {
    let t = 0;
    const send = vi.fn();
    const onChange = createBackSender({ send, now: () => t, idleMs: () => 0 });
    onChange('away');
    t += 10_000;
    onChange('back');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends back at exactly the away threshold', () => {
    let t = 0;
    const send = vi.fn();
    const onChange = createBackSender({ send, now: () => t, idleMs: () => 0 });
    onChange('away');
    t += AWAY_AFTER_MS;
    onChange('back');
    expect(send).toHaveBeenCalledWith('back', { idle_seconds: 300 });
  });

  it('counts the idle time already behind the away, not from when it was noticed', () => {
    let t = 1_000_000;
    const send = vi.fn();
    const onChange = createBackSender({ send, now: () => t, idleMs: () => AWAY_AFTER_MS });
    onChange('away');
    t += 60_000;
    onChange('back');
    expect(send).toHaveBeenCalledWith('back', { idle_seconds: 360 });
  });

  it('sends nothing for a lock with no idle behind it that ends soon', () => {
    let t = 1_000_000;
    const send = vi.fn();
    const onChange = createBackSender({ send, now: () => t, idleMs: () => 0 });
    onChange('away');
    t += 10_000;
    onChange('back');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing for back without a prior away', () => {
    const send = vi.fn();
    createBackSender({ send, now: () => 0, idleMs: () => 0 })('back');
    expect(send).not.toHaveBeenCalled();
  });
});

const win = (over: Partial<WindowEntry>): WindowEntry => ({
  id: '1',
  processName: 'Code.exe',
  title: 'a.ts',
  state: 'foreground',
  browser: false,
  ...over,
});

describe('frontWindow', () => {
  it('returns the foreground window', () => {
    expect(frontWindow([win({ state: 'background' }), win({})])).toEqual({
      app: 'Code.exe',
      title: 'a.ts',
    });
  });
  it('returns null for a blocked foreground window', () => {
    const blocked = { rule: 'processName', entry: 'Code.exe' } as WindowEntry['blocked'];
    expect(frontWindow([win({ blocked })])).toBeNull();
  });
  it('returns null with no foreground window', () => {
    expect(frontWindow([win({ state: 'minimized' })])).toBeNull();
  });
});

describe('startFocusWatch', () => {
  const setup = (opts: {
    front: () => Promise<{ app: string; title: string } | null>;
    enabled?: () => boolean;
  }) => {
    const send = vi.fn();
    const stop = startFocusWatch({ ...opts, enabled: opts.enabled ?? (() => true), send });
    return { send, stop };
  };

  it('sends once per change', async () => {
    let w = { app: 'a', title: 'x' };
    const { send } = setup({ front: async () => w });
    await vi.advanceTimersByTimeAsync(5_000);
    w = { app: 'b', title: 'y' };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send.mock.calls).toEqual([
      ['focus', { app: 'a', title: 'x' }],
      ['focus', { app: 'b', title: 'y' }],
    ]);
  });

  it('does not repeat an unchanged window', async () => {
    const { send } = setup({ front: async () => ({ app: 'a', title: 'x' }) });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while disabled', async () => {
    const front = vi.fn(async () => ({ app: 'a', title: 'x' }));
    const { send } = setup({ front, enabled: () => false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
    expect(front).not.toHaveBeenCalled();
  });

  it('sends nothing when there is no front window', async () => {
    const { send } = setup({ front: async () => null });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows a failing front() and runs the next tick', async () => {
    const front = vi
      .fn<() => Promise<{ app: string; title: string } | null>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ app: 'a', title: 'x' });
    const { send } = setup({ front });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stop clears the timer', async () => {
    const { send, stop } = setup({ front: async () => ({ app: 'a', title: 'x' }) });
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).not.toHaveBeenCalled();
  });
});
