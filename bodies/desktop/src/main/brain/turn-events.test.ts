/**
 * The brain-to-UI mapper, driven by hand: each contract notification in, the TurnEvents
 * the renderer expects out. No socket and no Electron involved.
 */
import { describe, expect, it } from 'vitest';
import { createTurnEvents } from './turn-events.js';

const T = 'turn-1';
let seq = 0;
const turn = (state: string, reason?: string, id = T) => ({
  seq: ++seq,
  turn: id,
  body: 'desktop',
  state,
  ...(reason ? { reason } : {}),
});
const delta = (d: string, id = T) => ({ seq: ++seq, turn: id, body: 'desktop', delta: d });
const make = (session: string | null = null) =>
  createTurnEvents(
    () => 'pet-1',
    () => session,
  );

describe('createTurnEvents', () => {
  it('maps turn started', () => {
    expect(make('sess-1').map('turn', turn('started'))).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'sess-1' },
    ]);
  });

  it("uses 'brain' as conversation id without a session", () => {
    const [e] = make().map('turn', turn('started'));
    expect(e).toMatchObject({ conversationId: 'brain' });
  });

  it('maps a reply delta and drops reply done', () => {
    const m = make();
    expect(m.map('reply', delta('Hi'))).toEqual([{ type: 'turn.delta', turnId: T, text: 'Hi' }]);
    expect(m.map('reply', { seq: 99, turn: T, body: 'desktop', done: true })).toEqual([]);
  });

  it.each([
    ['done', 'end'],
    ['cancelled', 'aborted'],
    ['step_cap', 'tool_limit'],
  ])('maps ended %s to completed %s with the joined deltas', (reason, stopReason) => {
    const m = make();
    m.map('turn', turn('started'));
    m.map('reply', delta('Hel'));
    m.map('reply', delta('lo'));
    expect(m.map('turn', turn('ended', reason))).toEqual([
      {
        type: 'turn.completed',
        turnId: T,
        text: 'Hello',
        stopReason,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);
  });

  it('maps ended over_budget to an error', () => {
    expect(make().map('turn', turn('ended', 'over_budget'))).toEqual([
      {
        type: 'turn.error',
        turnId: T,
        code: 'over_budget',
        message: "Scout has used today's budget. It starts again tomorrow.",
      },
    ]);
  });

  it('maps ended error to an error', () => {
    expect(make().map('turn', turn('ended', 'error'))).toEqual([
      {
        type: 'turn.error',
        turnId: T,
        code: 'brain_error',
        message: "Scout's brain hit a problem with that one. Try again?",
      },
    ]);
  });

  it('maps tool started and ended', () => {
    const m = make();
    const tool = { seq: 1, turn: T, call: 'c1', name: 'screen', state: 'started' };
    expect(m.map('tool', tool)).toEqual([
      {
        type: 'turn.toolRequest',
        turnId: T,
        approvalId: 'c1',
        callId: 'c1',
        tool: 'screen',
        input: {},
      },
    ]);
    expect(m.map('tool', { ...tool, state: 'ended', ok: false, summary: 'no' })).toEqual([
      {
        type: 'turn.toolResult',
        turnId: T,
        callId: 'c1',
        tool: 'screen',
        ok: false,
        summary: 'no',
      },
    ]);
  });

  it('maps ask and changed to nothing', () => {
    const m = make();
    expect(m.map('ask', {})).toEqual([]);
    expect(m.map('changed', {})).toEqual([]);
  });

  it('resync errors every open turn in start order, then clears', () => {
    const m = make();
    m.map('turn', turn('started', undefined, 'a'));
    m.map('turn', turn('started', undefined, 'b'));
    m.map('turn', turn('started', undefined, 'c'));
    m.map('turn', turn('ended', 'done', 'b'));
    const lost = (turnId: string) => ({
      type: 'turn.error',
      turnId,
      code: 'brain_restarted',
      message: 'Scout lost the thread there. Ask again?',
    });
    expect(m.resync()).toEqual([lost('a'), lost('c')]);
    expect(m.resync()).toEqual([]);
  });

  it('silent turn (no reply) completes with empty text', () => {
    const m = make();
    m.map('turn', turn('started'));
    const [e] = m.map('turn', turn('ended', 'done'));
    expect(e).toMatchObject({ type: 'turn.completed', text: '' });
  });

  it('two turns do not mix their text', () => {
    const m = make();
    m.map('turn', turn('started', undefined, 'a'));
    m.map('turn', turn('started', undefined, 'b'));
    m.map('reply', delta('one', 'a'));
    m.map('reply', delta('two', 'b'));
    expect(m.map('turn', turn('ended', 'done', 'a'))[0]).toMatchObject({ text: 'one' });
    expect(m.map('turn', turn('ended', 'done', 'b'))[0]).toMatchObject({ text: 'two' });
  });

  it('still maps events for a turn it never saw start', () => {
    const m = make();
    expect(m.map('reply', delta('x', 'z'))).toHaveLength(1);
    expect(m.map('turn', turn('ended', 'done', 'z'))[0]).toMatchObject({ text: 'x' });
  });
});
