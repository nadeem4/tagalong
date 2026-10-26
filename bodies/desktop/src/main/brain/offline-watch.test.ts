/** Tests for offlineWatch: open turns are failed only when the brain stays down. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineWatch } from './offline-watch';

describe('offlineWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up once the brain has been offline for the whole wait', () => {
    const giveUp = vi.fn();
    const watch = offlineWatch(giveUp, 10_000);
    watch('offline');
    vi.advanceTimersByTime(9_999);
    expect(giveUp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(giveUp).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the brain comes back in time', () => {
    const giveUp = vi.fn();
    const watch = offlineWatch(giveUp, 10_000);
    watch('offline');
    vi.advanceTimersByTime(5_000);
    watch('online');
    vi.advanceTimersByTime(20_000);
    expect(giveUp).not.toHaveBeenCalled();
  });

  it('keeps the first deadline through reconnect attempts', () => {
    const giveUp = vi.fn();
    const watch = offlineWatch(giveUp, 10_000);
    watch('offline');
    vi.advanceTimersByTime(6_000);
    watch('connecting');
    watch('offline');
    vi.advanceTimersByTime(4_000);
    expect(giveUp).toHaveBeenCalledTimes(1);
  });
});
