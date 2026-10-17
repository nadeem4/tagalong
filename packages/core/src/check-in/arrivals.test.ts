/**
 * Tests for Arrivals: finished work gathered into one wake, the quiet window and its ceiling,
 * holds (a call or full screen in front, talking), the next batch, and a wake that could not
 * be taken. FakeClock; no model.
 */
import { describe, expect, it } from 'vitest';
import type { WindowEntry } from '@tagalong/protocol';
import { FakeClock } from '../watch/fake-clock';
import {
  AFTER_TALK_MS,
  ARRIVAL_MAX_WAIT_MS,
  ARRIVAL_WINDOW_MS,
  Arrivals,
  HOLD_RECHECK_MS,
  fromHandoff,
  fromJob,
  type Arrival,
} from './arrivals';
import type { JobRow } from '../jobs/store';
import { win } from './test-support';

const SECOND = 1_000;

function item(n: number): Arrival {
  return { id: `j-000${n}`, kind: 'job', title: `job ${n}`, state: 'done', note: `note ${n}` };
}

function setup() {
  const clock = new FakeClock(1_000_000);
  const state = {
    windows: [win('w-1', 'parser.ts - Code')] as readonly WindowEntry[] | null,
    talkingUntil: 0,
    /** What the next wakes answer: false is "a check-in was already running". */
    taken: [] as boolean[],
    /** Set to hold a wake open until released. */
    release: null as null | (() => void),
    holdWake: false,
  };
  const wakes: Arrival[][] = [];
  const arrivals = new Arrivals({
    clock,
    windows: () => Promise.resolve(state.windows),
    talking: () => clock.now() < state.talkingUntil,
    wake: async (batch) => {
      wakes.push([...batch]);
      if (state.holdWake) await new Promise<void>((resolve) => (state.release = resolve));
      return state.taken.shift() ?? true;
    },
  });
  return { clock, state, wakes, arrivals };
}

describe('Arrivals', () => {
  it('one item wakes once, after the quiet window', async () => {
    const t = setup();
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS - SECOND);
    expect(t.wakes).toHaveLength(0);
    await t.clock.advance(SECOND);
    expect(t.wakes).toEqual([[item(1)]]);
    await t.clock.advance(10 * ARRIVAL_MAX_WAIT_MS);
    expect(t.wakes).toHaveLength(1);
  });

  it('five items close together are one wake with all five, oldest first', async () => {
    const t = setup();
    for (let n = 1; n <= 5; n += 1) {
      t.arrivals.add(item(n));
      await t.clock.advance(5 * SECOND);
    }
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    expect(t.wakes).toEqual([[item(1), item(2), item(3), item(4), item(5)]]);
  });

  it('each arrival pushes the wake back, never past the ceiling from the first', async () => {
    const t = setup();
    for (let n = 1; n <= 8; n += 1) {
      t.arrivals.add(item(n));
      await t.clock.advance(10 * SECOND);
      if (t.wakes.length > 0) break;
    }
    expect(t.wakes).toHaveLength(1);
    expect(t.wakes[0]).toHaveLength(ARRIVAL_MAX_WAIT_MS / (10 * SECOND));
  });

  it.each([
    ['full screen', [win('w-2', 'Film', { fullScreen: true })]],
    ['a call', [win('w-3', 'Meeting with Sam | Microsoft Teams', { processName: 'ms-teams.exe' })]],
  ])('holds while %s is in front, rechecks, and wakes once it is clear', async (_, front) => {
    const t = setup();
    t.state.windows = front;
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS + 4 * HOLD_RECHECK_MS);
    expect(t.wakes).toHaveLength(0);
    t.state.windows = [win('w-1', 'parser.ts - Code')];
    await t.clock.advance(HOLD_RECHECK_MS);
    expect(t.wakes).toEqual([[item(1)]]);
  });

  it('holds while they talk, and wakes only once the talk has been over a while', async () => {
    const t = setup();
    t.state.talkingUntil = t.clock.now() + 2 * ARRIVAL_MAX_WAIT_MS + AFTER_TALK_MS;
    t.arrivals.add(item(1));
    await t.clock.advance(2 * ARRIVAL_MAX_WAIT_MS + AFTER_TALK_MS - SECOND);
    expect(t.wakes).toHaveLength(0);
    await t.clock.advance(HOLD_RECHECK_MS + SECOND);
    expect(t.wakes).toHaveLength(1);
  });

  it('with no host to list windows, nothing holds', async () => {
    const t = setup();
    t.state.windows = null;
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    expect(t.wakes).toHaveLength(1);
  });

  it('an item that arrives during a wake starts the next batch', async () => {
    const t = setup();
    t.state.holdWake = true;
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    t.arrivals.add(item(2));
    t.state.holdWake = false;
    t.state.release?.();
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    expect(t.wakes).toEqual([[item(1)], [item(2)]]);
  });

  it('a wake that could not be taken keeps the batch and tries again', async () => {
    const t = setup();
    t.state.taken = [false];
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    t.arrivals.add(item(2));
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    expect(t.wakes).toEqual([[item(1)], [item(1), item(2)]]);
  });

  it('a wake that throws, or a window list that throws, loses nothing and never crashes', async () => {
    const clock = new FakeClock(0);
    const wakes: Arrival[][] = [];
    let listFails = true;
    let wakeFails = true;
    const arrivals = new Arrivals({
      clock,
      windows: () => (listFails ? Promise.reject(new Error('host gone')) : Promise.resolve([])),
      talking: () => false,
      wake: (batch) => {
        wakes.push([...batch]);
        if (wakeFails) return Promise.reject(new Error('closed'));
        return Promise.resolve(true);
      },
    });
    arrivals.add(item(1));
    await clock.advance(ARRIVAL_WINDOW_MS);
    expect(wakes).toHaveLength(0);
    listFails = false;
    await clock.advance(HOLD_RECHECK_MS);
    expect(wakes).toHaveLength(1);
    wakeFails = false;
    await clock.advance(HOLD_RECHECK_MS);
    expect(wakes).toEqual([[item(1)], [item(1)]]);
    await clock.advance(ARRIVAL_MAX_WAIT_MS);
    expect(wakes).toHaveLength(2);
  });

  it('after stop, nothing wakes', async () => {
    const t = setup();
    t.arrivals.add(item(1));
    t.arrivals.stop();
    t.arrivals.add(item(2));
    await t.clock.advance(ARRIVAL_MAX_WAIT_MS);
    expect(t.wakes).toHaveLength(0);
    expect(t.clock.pendingTimers).toBe(0);
  });
});

describe('what arrives', () => {
  const HANDOFF = '91ab0000-0000-4000-8000-000000000001';
  const expert = { expertName: 'Claude Code', ask: 'fix the login test\n\nWindow: secret' };

  it('a hand-off: its expert and ask, the first line of its answer, and the whole answer', () => {
    expect(
      fromHandoff(
        { handoffId: HANDOFF, expertId: 'cc', state: 'done', text: '\nAll green.\nDetails.' },
        expert,
      ),
    ).toEqual({
      id: 'h-91ab',
      kind: 'expert',
      title: 'Claude Code: "fix the login test"',
      state: 'done',
      note: 'All green.',
      detail: '\nAll green.\nDetails.',
      handoffId: HANDOFF,
    });
    expect(
      fromHandoff({ handoffId: HANDOFF, expertId: 'cc', state: 'error', error: 'boom' }, null),
    ).toMatchObject({ title: 'An expert: ""', state: 'error', note: 'boom' });
  });

  it('a stopped hand-off, or a step that hands on to another, never arrives', () => {
    const params = { handoffId: HANDOFF, expertId: 'cc' } as const;
    expect(fromHandoff({ ...params, state: 'stopped' }, expert)).toBeNull();
    expect(
      fromHandoff(
        { ...params, state: 'done', next: { handoffId: HANDOFF, expertId: 'w', expertName: 'W' } },
        expert,
      ),
    ).toBeNull();
  });

  it('a job: its task, its note or why it failed', () => {
    const row: JobRow = {
      id: '1b2c0000-0000-4000-8000-000000000003',
      state: 'done',
      petId: 'scout',
      task: 'summarise the thread',
      dedupeKey: 'summarise the thread',
      conversationId: 'c1',
      note: 'Friday it is.',
      error: null,
      createdAt: '',
      startedAt: null,
      finishedAt: null,
      reportedAt: null,
    };
    expect(fromJob(row)).toEqual({
      id: 'j-1b2c',
      kind: 'job',
      title: 'summarise the thread',
      state: 'done',
      note: 'Friday it is.',
      jobId: row.id,
    });
    expect(fromJob({ ...row, state: 'error', note: null, error: 'offline' })).toMatchObject({
      state: 'error',
      note: 'offline',
    });
  });
});

describe('Arrivals, stopped during a wake', () => {
  it('schedules nothing more once the wake is over', async () => {
    const t = setup();
    t.state.holdWake = true;
    t.state.taken = [false];
    t.arrivals.add(item(1));
    await t.clock.advance(ARRIVAL_WINDOW_MS);
    t.arrivals.add(item(2));
    t.arrivals.stop();
    t.state.release?.();
    await t.clock.advance(ARRIVAL_MAX_WAIT_MS);
    expect(t.wakes).toHaveLength(1);
    expect(t.clock.pendingTimers).toBe(0);
  });
});
