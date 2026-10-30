/** Tests for presence (away and back). */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AWAY_AFTER_MS, PRESENCE_POLL_MS, startPresence, watchPresence } from './presence';

describe('startPresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const idle = { ms: 0 };
    const changes: Array<'away' | 'back'> = [];
    const presence = startPresence({ idleMs: () => idle.ms, onChange: (c) => changes.push(c) });
    return { idle, changes, presence };
  }

  it('is away once the idle time reaches five minutes, and says so once', () => {
    const { idle, changes, presence } = setup();
    idle.ms = AWAY_AFTER_MS - 1;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(changes).toEqual([]);
    idle.ms = AWAY_AFTER_MS;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    idle.ms = AWAY_AFTER_MS + PRESENCE_POLL_MS;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(changes).toEqual(['away']);
    presence.stop();
  });

  it('is back as soon as there is input again', () => {
    const { idle, changes, presence } = setup();
    idle.ms = AWAY_AFTER_MS;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    idle.ms = 0;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(changes).toEqual(['away', 'back']);
    presence.stop();
  });

  it('is away at once when the screen locks, and back on unlock', () => {
    const { changes, presence } = setup();
    presence.lock();
    expect(changes).toEqual(['away']);
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(changes).toEqual(['away']);
    presence.unlock();
    expect(changes).toEqual(['away', 'back']);
    presence.stop();
  });

  it('wires a power monitor: idle seconds, lock and unlock, to presence events', () => {
    const listeners = new Map<string, () => void>();
    const power = {
      idleSeconds: 0,
      getSystemIdleTime: () => power.idleSeconds,
      on: (event: 'lock-screen' | 'unlock-screen', listener: () => void) =>
        listeners.set(event, listener),
      removeListener: (event: 'lock-screen' | 'unlock-screen') => listeners.delete(event),
    };
    const sent: Array<{ type: string }> = [];
    const stop = watchPresence(power, (event) => sent.push(event));
    power.idleSeconds = AWAY_AFTER_MS / 1000;
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(sent).toEqual([{ type: 'presence.away' }]);
    listeners.get('unlock-screen')!();
    listeners.get('lock-screen')!();
    expect(sent.map((event) => event.type)).toEqual([
      'presence.away',
      'presence.back',
      'presence.away',
    ]);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('stops polling when stopped', () => {
    const { idle, changes, presence } = setup();
    presence.stop();
    idle.ms = AWAY_AFTER_MS;
    vi.advanceTimersByTime(PRESENCE_POLL_MS * 2);
    expect(changes).toEqual([]);
  });
});
