/** Tests for Asks: held app changes, free hand-off cards, expiry, restart and the broadcasts. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../memory/db';
import { Asks, FREE_ASK_MS, HELD_ASK_MS, type AskEvent } from './asks';
import { AskStore } from './store';

const TURN = '6f1c1b8e-3b1c-4c8e-9a51-0b1f6f1d2a3c';
const HELD = {
  turnId: TURN,
  petId: 'scout',
  app: 'Notion',
  tool: 'create_page',
  summary: 'Create a page.\ntitle: Plan',
  risk: 'change' as const,
};
const FREE = {
  petId: 'scout',
  expertId: 'claude-code',
  summary: 'Fix the failing test',
  payload: { expertId: 'claude-code', petId: 'scout', brief: { ask: 'Fix the failing test' } },
  originTurnId: TURN,
};

let db: Database.Database;
let events: AskEvent[];
let outcomes: [string, string][];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T10:00:00.000Z'));
  db = new Database(':memory:');
  migrate(db);
  events = [];
  outcomes = [];
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

function make(): Asks {
  return new Asks({
    store: new AskStore(db),
    emit: (event) => events.push(event),
    outcome: (turnId, name) => outcomes.push([turnId, name]),
    expertName: (id) => (id === 'claude-code' ? 'Claude Code' : undefined),
  });
}

const confirms = () => events.filter((event) => event.method === 'connector.confirm');
const changes = () => events.filter((event) => event.method === 'asks.changed');
const shownId = () => {
  const shown = confirms()[0];
  if (shown?.method !== 'connector.confirm') throw new Error('no confirm card');
  return shown.params.approvalId;
};

describe('Asks, held', () => {
  it('shows the confirm card with the row id and the risk, and waits for Allow once', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    expect(confirms()).toEqual([
      {
        method: 'connector.confirm',
        params: {
          approvalId: expect.any(String),
          turnId: TURN,
          petId: 'scout',
          app: 'Notion',
          tool: 'create_page',
          summary: HELD.summary,
          risk: 'change',
        },
      },
    ]);
    const id = shownId();
    expect(asks.get(id)?.state).toBe('waiting');
    expect(asks.answer(id, 'approve')).toBe(true);
    expect(await answer).toBe('approved');
    expect(asks.answer(id, 'approve')).toBe(false);
    expect(asks.get(id)).toMatchObject({ state: 'approved', answeredBy: 'you' });
  });

  it('resolves declined on Decline', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    asks.answer(shownId(), 'decline');
    expect(await answer).toBe('declined');
  });

  it('cancels when the turn is stopped, and settles it turn-ended', async () => {
    const asks = make();
    const controller = new AbortController();
    const answer = asks.hold(HELD, controller.signal);
    controller.abort();
    expect(await answer).toBe('cancelled');
    expect(asks.get(shownId())).toMatchObject({ state: 'cancelled', note: 'turn-ended' });
    expect(asks.get(shownId())?.answeredBy).toBeUndefined();
  });

  it('cancels at once, with no card, when the turn is already stopped', async () => {
    const asks = make();
    const controller = new AbortController();
    controller.abort();
    expect(await asks.hold(HELD, controller.signal)).toBe('cancelled');
    expect(confirms()).toEqual([]);
  });

  it('expires after an hour, and silence never approves', async () => {
    const asks = make();
    let settled: string | undefined;
    void asks.hold(HELD, new AbortController().signal).then((state) => (settled = state));
    await vi.advanceTimersByTimeAsync(HELD_ASK_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe('expired');
    expect(asks.get(shownId())).toMatchObject({ state: 'expired', note: 'expired' });
  });

  it('is never approved past its time, even when its timer is late (the computer slept)', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    // The clock moves past the hour, but the timer has not fired yet.
    vi.setSystemTime(Date.now() + HELD_ASK_MS);
    expect(asks.answer(shownId(), 'approve')).toBe(false);
    expect(await answer).toBe('expired');
    expect(asks.get(shownId())).toMatchObject({ state: 'expired', note: 'expired' });
  });

  it('broadcasts the waiting list after every change', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    expect(changes().at(-1)).toMatchObject({
      params: { waiting: [{ id: shownId(), kind: 'app-change', risk: 'change' }] },
    });
    asks.answer(shownId(), 'approve');
    await answer;
    expect(changes().at(-1)).toEqual({ method: 'asks.changed', params: { waiting: [] } });
    expect(changes()).toHaveLength(2);
  });

  it('writes the outcome on the episode of the turn that asked', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    asks.answer(shownId(), 'decline');
    await answer;
    expect(outcomes).toEqual([[TURN, 'declined']]);
  });

  it('closes held asks on quit as expired, closed', async () => {
    const asks = make();
    const answer = asks.hold(HELD, new AbortController().signal);
    asks.add(FREE);
    asks.closeHeld();
    expect(await answer).toBe('expired');
    expect(asks.get(shownId())).toMatchObject({ state: 'expired', note: 'closed' });
    expect(asks.waiting().map((row) => row.kind)).toEqual(['handoff']);
  });
});

describe('Asks, free', () => {
  it('saves a hand-off card waiting, named by its expert in the list', () => {
    const asks = make();
    const { id } = asks.add(FREE);
    expect(asks.list().waiting).toEqual([
      expect.objectContaining({
        id,
        kind: 'handoff',
        risk: 'change',
        summary: 'Fix the failing test',
        expertName: 'Claude Code',
        originTurnId: TURN,
        state: 'waiting',
      }),
    ]);
    expect(changes()).toHaveLength(1);
  });

  it('is never approved from here: Send needs a folder', () => {
    const asks = make();
    const { id } = asks.add(FREE);
    expect(asks.answer(id, 'approve')).toBe(false);
    expect(asks.get(id)?.state).toBe('waiting');
    expect(asks.answer(id, 'decline')).toBe(true);
    expect(asks.get(id)?.state).toBe('declined');
  });

  it('expires after a day', async () => {
    const asks = make();
    const { id } = asks.add(FREE);
    await vi.advanceTimersByTimeAsync(FREE_ASK_MS);
    expect(asks.get(id)).toMatchObject({ state: 'expired', note: 'expired' });
    expect(outcomes).toEqual([[TURN, 'expired']]);
  });

  it('reads a card past its time as expired, even when its timer is late', () => {
    const asks = make();
    const { id } = asks.add(FREE);
    vi.setSystemTime(Date.now() + FREE_ASK_MS);
    expect(asks.get(id)).toMatchObject({ state: 'expired', note: 'expired' });
    expect(asks.answer(id, 'decline')).toBe(false);
  });
});

describe('Asks at boot', () => {
  it('closes a held ask, keeps a hand-off and re-arms its timer, expires one past its time', async () => {
    const before = make();
    void before.hold(HELD, new AbortController().signal);
    const held = shownId();
    const kept = before.add(FREE).id;
    const stale = before.add({ ...FREE, summary: 'Old one' }).id;
    before.stop();
    // Quit; the stale card's time passed while Tagalong was closed.
    db.prepare(`UPDATE asks SET expires_at = ? WHERE id = ?`).run(
      '2026-10-22T09:00:00.000Z',
      stale,
    );
    outcomes = [];
    const after = make();
    after.boot();
    expect(after.get(held)).toMatchObject({ state: 'expired', note: 'closed' });
    expect(after.get(stale)).toMatchObject({ state: 'expired', note: 'expired' });
    expect(after.get(kept)?.state).toBe('waiting');
    expect(outcomes).toEqual([
      [TURN, 'expired'],
      [TURN, 'expired'],
    ]);
    await vi.advanceTimersByTimeAsync(FREE_ASK_MS);
    expect(after.get(kept)).toMatchObject({ state: 'expired', note: 'expired' });
  });
});
