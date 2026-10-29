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

describe('createTurnEvents brain-started turns', () => {
  const brainTurn = (state: string, reason?: string) => ({
    ...turn(state, reason),
    ...(state === 'started' ? { started_by: 'brain' } : {}),
  });
  const toolFrame = (state: string) => ({
    seq: ++seq,
    turn: T,
    body: 'desktop',
    call: 'c1',
    name: 'see_screen',
    state,
  });

  it('a brain-started turn shows nothing while it runs', () => {
    const m = make();
    expect(m.map('turn', brainTurn('started'))).toEqual([]);
    expect(m.map('reply', delta('Hi'))).toEqual([]);
    expect(m.map('tool', toolFrame('started'))).toEqual([]);
    expect(m.map('tool', toolFrame('ended'))).toEqual([]);
  });

  it('a silent brain-started turn that ends shows nothing', () => {
    const m = make();
    m.map('turn', brainTurn('started'));
    expect(m.map('turn', brainTurn('ended', 'done'))).toEqual([]);
  });

  it('a brain-started turn with words ends as one pet.remark carrying the text', () => {
    const m = make();
    m.map('turn', brainTurn('started'));
    m.map('reply', delta('Time to '));
    m.map('reply', delta('stretch.'));
    const events = m.map('turn', brainTurn('ended', 'done'));
    expect(events).toEqual([
      {
        type: 'pet.remark',
        remarkId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        petId: 'pet-1',
        text: 'Time to stretch.',
      },
    ]);
  });

  it.each(['error', 'over_budget', 'cancelled', 'step_cap'])(
    'a brain-started turn that ends %s shows nothing',
    (reason) => {
      const m = make();
      m.map('turn', brainTurn('started'));
      m.map('reply', delta('Half a thought'));
      expect(m.map('turn', brainTurn('ended', reason))).toEqual([]);
    },
  );

  it('a user-started turn is unchanged', () => {
    const user = { ...turn('started'), started_by: 'user' };
    expect(make().map('turn', user)).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
    ]);
    expect(make().map('turn', turn('started'))).toHaveLength(1);
  });

  it('resync forgets quiet turns', () => {
    const m = make();
    m.map('turn', brainTurn('started'));
    m.map('reply', delta('Hi'));
    expect(m.resync()).toEqual([]);
    // A later turn with the same id is an ordinary one.
    expect(m.map('turn', turn('started'))).toHaveLength(1);
  });
});

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

  it('a reply for an unseen turn counts as open for resync', () => {
    const m = make();
    m.map('reply', delta('Hi', 'z'));
    expect(m.resync()).toMatchObject([
      { type: 'turn.error', turnId: 'z', code: 'brain_restarted' },
    ]);
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

describe('createTurnEvents: asks', () => {
  const open = (over: Record<string, unknown> = {}) => ({
    seq: ++seq,
    id: 'a1',
    state: 'open',
    turn: T,
    text: "I'll move the window.",
    options: ['allow', 'always', 'deny'],
    confirm: true,
    tool: 'desktop__move_window',
    input: { x: 1 },
    ...over,
  });
  const closed = (id = 'a1') => ({
    seq: ++seq,
    id,
    state: 'closed',
    reason: 'answered',
    option: 'allow',
  });

  it('maps a confirm ask to one connector.confirm carrying the ask id, words and options', () => {
    expect(make().map('ask', open())).toEqual([
      {
        type: 'connector.confirm',
        approvalId: 'a1',
        turnId: T,
        petId: 'pet-1',
        app: 'Desktop',
        tool: 'desktop__move_window',
        summary: "I'll move the window.",
        options: ['allow', 'always', 'deny'],
      },
    ]);
  });

  it('a locked ask carries no always', () => {
    const [e] = make().map('ask', open({ options: ['allow', 'deny'] }));
    expect(e).toMatchObject({ options: ['allow', 'deny'] });
  });

  it('an empty text shows the tool and its input instead', () => {
    const [e] = make().map('ask', open({ text: '', input: { x: 1, title: 'Notes' } }));
    expect(e).toMatchObject({ summary: 'desktop__move_window\nx: 1\ntitle: Notes' });
  });

  it("a brain tool's ask belongs to Scout", () => {
    const [e] = make().map('ask', open({ tool: 'forget_memory' }));
    expect(e).toMatchObject({ app: 'Scout' });
  });

  // Asks a Claude Code job opens have no turn and no confirm (custom option names).
  describe('asks with no turn and no confirm', () => {
    const jobAsk = (over: Record<string, unknown> = {}) => {
      const { turn: _turn, confirm: _confirm, ...rest } = open();
      return { ...rest, ...over };
    };

    it('the hand-off ask carries the task, the folder and every mode plus cancel', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Fix the login bug',
          tool: 'hand_off',
          input: { folder: 'C:\\work\\app' },
          options: ['Plan', 'Edit', 'cancel'],
        }),
      );
      expect(e).toEqual({
        type: 'connector.confirm',
        approvalId: 'a1',
        turnId: '',
        petId: 'pet-1',
        app: 'Scout',
        tool: 'hand_off',
        summary: 'Fix the login bug\nfolder: C:\\work\\app',
        options: ['Plan', 'Edit', 'cancel'],
      });
    });

    it('a relayed Claude Code permission ask shows the tool, its input and its own options', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: '',
          tool: 'claude_code:Edit file',
          input: { path: 'a.ts' },
          options: ['Allow once', 'Reject'],
        }),
      );
      expect(e).toMatchObject({
        type: 'connector.confirm',
        app: 'Claude Code',
        tool: 'claude_code:Edit file',
        summary: 'claude_code:Edit file\npath: a.ts',
        options: ['Allow once', 'Reject'],
      });
    });

    it('a question ask (no tool) is marked as a question and keeps its choices', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Which database?',
          options: ['sqlite', 'postgres'],
          tool: undefined,
          input: undefined,
        }),
      );
      expect(e).toMatchObject({
        type: 'connector.confirm',
        app: 'Claude Code',
        summary: 'Which database?',
        options: ['sqlite', 'postgres'],
        question: true,
      });
    });

    it('a question ask with no text still has a prompt', () => {
      const [e] = make().map(
        'ask',
        jobAsk({ text: '', options: [], tool: undefined, input: undefined }),
      );
      expect(e).toMatchObject({ question: true, summary: 'Claude Code asks' });
    });

    it('a cancelled close dismisses the card with no turn running', () => {
      const m = make();
      m.map(
        'ask',
        jobAsk({ tool: 'hand_off', input: { folder: 'x' }, options: ['Plan', 'cancel'] }),
      );
      expect(m.map('ask', { seq: ++seq, id: 'a1', state: 'closed', reason: 'cancelled' })).toEqual([
        { type: 'connector.dismiss', approvalId: 'a1' },
      ]);
    });
  });

  // Home counts asks.changed and lists them from the old engine, which knows nothing of the
  // brain's asks, so a brain ask is dismissed through an event only the bubble handles.
  it('a closed ask dismisses just that card and never emits asks.changed', () => {
    const m = make();
    m.map('ask', open());
    m.map('ask', open({ id: 'a2' }));
    expect(m.map('ask', closed('a1'))).toEqual([{ type: 'connector.dismiss', approvalId: 'a1' }]);
    expect(m.map('ask', closed('a2'))).toEqual([{ type: 'connector.dismiss', approvalId: 'a2' }]);
  });

  it('a closed ask it never showed maps to nothing', () => {
    expect(make().map('ask', closed('zz'))).toEqual([]);
  });

  it('a lost brain dismisses every open ask', () => {
    const m = make();
    m.map('ask', open());
    m.map('ask', open({ id: 'a2' }));
    expect(m.resync()).toEqual([
      { type: 'connector.dismiss', approvalId: 'a1' },
      { type: 'connector.dismiss', approvalId: 'a2' },
    ]);
  });
});

describe('createTurnEvents claim and blank remarks', () => {
  const brainStart = () => ({ ...turn('started'), started_by: 'brain' });

  it('a claimed wake turn continues as a normal turn with the text so far', () => {
    const m = make('conv-1');
    m.map('turn', brainStart());
    m.map('reply', delta('Time to '));
    expect(m.claim(T)).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'conv-1' },
      { type: 'turn.delta', turnId: T, text: 'Time to ' },
    ]);
    expect(m.map('reply', delta('stretch.'))).toEqual([
      { type: 'turn.delta', turnId: T, text: 'stretch.' },
    ]);
    const ended = m.map('turn', turn('ended', 'done'));
    expect(ended).toEqual([
      {
        type: 'turn.completed',
        turnId: T,
        text: 'Time to stretch.',
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);
    expect(ended.some((e) => e.type === 'pet.remark')).toBe(false);
  });

  it('claiming before any words sends only turn.started', () => {
    const m = make();
    m.map('turn', brainStart());
    expect(m.claim(T)).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
    ]);
  });

  it('claiming a turn that is not a quiet one sends nothing', () => {
    const m = make();
    m.map('turn', turn('started'));
    expect(m.claim(T)).toEqual([]);
    expect(m.claim('unknown')).toEqual([]);
  });

  it('a brain-started turn with only whitespace shows nothing', () => {
    const m = make();
    m.map('turn', brainStart());
    m.map('reply', delta(' \n '));
    expect(m.map('turn', turn('ended', 'done'))).toEqual([]);
  });
});
