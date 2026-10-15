import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import {
  AWAY_AFTER_MS,
  PRESENCE_POLL_MS,
  WELLBEING_TICK_MS,
  startPresence,
  startWellbeingTick,
  watchPresence,
} from './presence';

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

describe('startWellbeingTick', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const editor: WindowEntry = {
    id: 'w-1',
    processName: 'Code.exe',
    title: 'parser.ts',
    state: 'foreground',
    browser: false,
  };

  function setup() {
    const state = { enabled: true, paused: false, idleMs: 1_000, failList: false };
    const sent: Array<{ idleMs: number; windows: WindowEntry[] }> = [];
    let lists = 0;
    const stop = startWellbeingTick({
      enabled: () => state.enabled && !state.paused,
      idleMs: () => state.idleMs,
      list: () => {
        lists += 1;
        return state.failList ? Promise.reject(new Error('no windows')) : Promise.resolve([editor]);
      },
      send: (params) => {
        sent.push(params);
        return Promise.resolve({});
      },
    });
    return { state, sent, stop, lists: () => lists };
  }

  it('sends the idle time and the titles every 60 s while on', async () => {
    const { sent, stop } = setup();
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([{ idleMs: 1_000, windows: [editor] }]);
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS);
    expect(sent).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('lists nothing and sends nothing while off or while sight is paused', async () => {
    const { state, sent, lists } = setup();
    state.enabled = false;
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS * 2);
    state.enabled = true;
    state.paused = true;
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS * 2);
    expect(sent).toEqual([]);
    expect(lists()).toBe(0);
  });

  it('skips a tick whose listing fails, and tries again next time', async () => {
    const { state, sent } = setup();
    state.failList = true;
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS);
    expect(sent).toEqual([]);
    state.failList = false;
    await vi.advanceTimersByTimeAsync(WELLBEING_TICK_MS);
    expect(sent).toHaveLength(1);
  });
});
