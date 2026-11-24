/**
 * The brain-to-UI mapper, driven by hand: each contract notification in, the TurnEvents
 * the renderer expects out. No socket and no Electron involved.
 */
import { describe, expect, it } from 'vitest';
import { dockMood, IDLE_DOCK, nextDock, type DockEvent } from '../../renderer/src/dock.js';
import { createTurnEvents } from './turn-events.js';

const T = 'turn-1';
let seq = 0;
const turn = (state: string, reason?: string, id = T) => ({
  seq: ++seq,
  turn: id,
  body: 'desktop',
  state,
  ...(state === 'ended' ? {} : { events: ['e1'], source: 'desktop' }),
  ...(reason ? { reason } : {}),
});
const delta = (d: string, id = T) => ({ seq: ++seq, turn: id, body: 'desktop', delta: d });
// The helper turns carry say id e1, and the mapper here has sent it: they are my own turns.
// A wake is built with other event ids.
const make = (session: string | null = null) => {
  const m = createTurnEvents(
    () => 'pet-1',
    () => session,
  );
  m.trackSay('e1');
  return m;
};

describe('createTurnEvents brain-started turns', () => {
  const brainTurn = (state: string, reason?: string) => ({
    ...turn(state, reason),
    ...(state === 'started' ? { source: 'timer:t1', events: ['w1'] } : {}),
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

  it('a turn whose events include my say is mine', () => {
    const m = make();
    m.trackSay('s1');
    const started = { ...turn('started'), events: ['s1'], source: 'scout' };
    expect(m.map('turn', started)).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
    ]);
  });

  it('a say is forgotten once its turn ends, so a later turn holding its id is not mine', () => {
    const m = make();
    m.trackSay('s1');
    m.map('turn', { ...turn('started'), events: ['s1'], source: 'scout' });
    m.map('turn', turn('ended', 'done'));
    expect(
      m.map('turn', { ...turn('started', undefined, 'turn-2'), events: ['s1'], source: 'scout' }),
    ).toEqual([]);
  });

  it('an untracked say is not mine', () => {
    const m = make();
    m.trackSay('s1');
    m.untrackSay('s1');
    expect(m.map('turn', { ...turn('started'), events: ['s1'], source: 'scout' })).toEqual([]);
  });

  it('a turn sourced by job:x is quiet', () => {
    const m = make();
    const started = { ...turn('started'), events: ['w1'], source: 'job:x' };
    expect(m.map('turn', started)).toEqual([]);
    expect(m.map('reply', delta('hidden'))).toEqual([]);
  });

  it("a turn that took none of my says is quiet, whatever its source (a body's wake)", () => {
    const m = make();
    const started = { ...turn('started'), events: ['back1'], source: 'desktop' };
    expect(m.map('turn', started)).toEqual([]);
    m.map('reply', delta('Welcome back.'));
    expect(m.map('turn', turn('ended', 'done'))).toEqual([
      {
        type: 'pet.remark',
        remarkId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        petId: 'pet-1',
        text: 'Welcome back.',
      },
    ]);
  });

  it("another body's say is not mine, so its turn is quiet here", () => {
    const m = make();
    expect(m.map('turn', { ...turn('started'), events: ['b1'], source: 'browser' })).toEqual([]);
  });

  it('my say joining a turn that is not quiet still emits turn.started', () => {
    const m = make();
    m.trackSay('s1');
    m.trackSay('s2');
    m.map('turn', { ...turn('started'), events: ['s1'], source: 'desktop' });
    m.map('reply', delta('So far'));
    expect(m.map('turn', { ...turn('joined'), events: ['s2'], source: 'desktop' })).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
      { type: 'turn.delta', turnId: T, text: 'So far' },
    ]);
  });

  it('my say joining a quiet turn shows it from then on, with the words so far', () => {
    const m = make();
    m.trackSay('s2');
    m.map('turn', brainTurn('started'));
    m.map('reply', delta('So far'));
    const joined = { ...turn('joined'), events: ['s2'], source: 'timer:t1' };
    expect(m.map('turn', joined)).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
      { type: 'turn.delta', turnId: T, text: 'So far' },
    ]);
    expect(m.map('reply', delta(' more'))).toEqual([
      { type: 'turn.delta', turnId: T, text: ' more' },
    ]);
  });

  it("someone else's event joining a quiet turn changes nothing", () => {
    const m = make();
    m.map('turn', brainTurn('started'));
    const joined = { ...turn('joined'), events: ['other'], source: 'timer:t1' };
    expect(m.map('turn', joined)).toEqual([]);
    expect(m.map('reply', delta('x'))).toEqual([]);
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

  it('shows_a_turn_whatever_body_it_names', () => {
    // A page asked from the browser: the turn names another body or none, and still shows here.
    for (const body of ['chrome-ab12', null]) {
      const m = make('sess-1');
      const named = (f: object) => ({ ...f, body });
      expect(m.map('turn', named(turn('started')))).toEqual([
        { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'sess-1' },
      ]);
      expect(m.map('reply', named(delta('Hi')))).toEqual([
        { type: 'turn.delta', turnId: T, text: 'Hi' },
      ]);
    }
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
        message: "Scout's brain hit a problem with that one.",
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

  it('strips the body prefix from a body tool name, so the dock sees look_at_window', () => {
    const m = make();
    const tool = { seq: 1, turn: T, call: 'c1', name: 'desktop__look_at_window', state: 'started' };
    const [request] = m.map('tool', tool) as DockEvent[];
    expect(request).toMatchObject({ type: 'turn.toolRequest', tool: 'look_at_window' });
    const [result] = m.map('tool', { ...tool, state: 'ended' }) as DockEvent[];
    expect(result).toMatchObject({ type: 'turn.toolResult', tool: 'look_at_window' });
    const started = nextDock(IDLE_DOCK, { type: 'turn.started', turnId: T, petId: 'scout' });
    expect(dockMood(nextDock(started, request!))).toBe('reading');
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
        facts: { x: 1 },
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

  it('an approval offer keeps its words only, not its sentence and group lines', () => {
    const [e] = make().map(
      'ask',
      open({
        tool: 'approval_offer',
        confirm: false,
        text: 'Approve it from now on?',
        input: { sentence: 'Approve test runs', group: 'C:/work/app' },
      }),
    );
    expect(e).toMatchObject({ summary: 'Approve it from now on?' });
  });

  it("a tool-gate ask carries the tool's input as facts for the card's rows", () => {
    const [e] = make().map(
      'ask',
      open({ tool: 'gmail__send_message', text: 'Send it?', input: { to: 'sam@x.example' } }),
    );
    expect(e).toMatchObject({ summary: 'Send it?', facts: { to: 'sam@x.example' } });
  });

  it('an approval offer carries no facts', () => {
    const [e] = make().map(
      'ask',
      open({ tool: 'approval_offer', confirm: false, text: 'Approve?', input: { group: 'g' } }),
    );
    expect(e).not.toHaveProperty('facts');
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

    it("a hand-off card's apps are a line of names in its facts, not JSON", () => {
      const apps = [{ id: 'lin', name: 'Linear' }];
      const [e] = make().map(
        'ask',
        open({ text: 'Fix it', tool: 'hand_off', input: { folder: 'C:\\p', apps } }),
      );
      expect(e).toMatchObject({
        type: 'connector.confirm',
        summary: 'Fix it',
        facts: { folder: 'C:\\p', apps: 'Linear' },
      });
    });

    it("another expert's permission ask is labelled by that expert, not Scout", () => {
      const [e] = make().map(
        'ask',
        jobAsk({ text: '', tool: 'codex-acp:Run command', input: {}, options: ['Allow once'] }),
      );
      expect(e).toMatchObject({ type: 'connector.confirm', app: 'Codex' });
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

    it("Scout's choose ask carries free_text and recommended onto the card", () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Which expert?',
          options: ['Gemini CLI', 'Claude Code'],
          tool: 'choose',
          input: undefined,
          free_text: true,
          recommended: 'Claude Code',
        }),
      );
      expect(e).toMatchObject({
        app: 'Scout',
        tool: 'choose',
        freeText: true,
        recommended: 'Claude Code',
      });
      expect(e).not.toHaveProperty('question');
    });

    it('a task card carries the task, its check-back time and who chose it', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Send it?',
          options: ['allow', 'deny', 'not_now', 'stop_task'],
          tool: 'send_message',
          task: { id: 'k1', title: 'Fix the build' },
          check_back_at: '2030-01-05T15:30:00+00:00',
          check_back_by: 'person',
        }),
      );
      expect(e).toMatchObject({
        task: { id: 'k1', title: 'Fix the build' },
        checkBackAt: '2030-01-05T15:30:00+00:00',
        checkBackBy: 'person',
      });
    });

    it('a task card carries urgent so the card can say it matters now', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Send it?',
          options: ['allow', 'deny', 'not_now', 'stop_task'],
          tool: 'send_message',
          task: { id: 'k1' },
          urgent: true,
        }),
      );
      expect(e).toMatchObject({ urgent: true });
    });

    it("Scout's save_preference ask (a tool, no free_text) is Scout's, not a question", () => {
      const [e] = make().map(
        'ask',
        jobAsk({ text: 'Keep it?', options: ['allow', 'deny'], tool: 'save_preference' }),
      );
      expect(e).toMatchObject({ app: 'Scout', tool: 'save_preference' });
      expect(e).not.toHaveProperty('question');
    });

    it("Scout's save_preference ask (a tool, no free_text) is Scout's, not a question", () => {
      const [e] = make().map(
        'ask',
        jobAsk({ text: 'Keep it?', options: ['allow', 'deny'], tool: 'save_preference' }),
      );
      expect(e).toMatchObject({ app: 'Scout', tool: 'save_preference' });
      expect(e).not.toHaveProperty('question');
    });

    it('an install ask carries its card facts, so the chat can draw the one install card', () => {
      const facts = { app: 'Notion', official: true, runs: 'hosted', sign_in: 'browser' };
      const [e] = make().map(
        'ask',
        jobAsk({ text: '', tool: 'install_app', input: facts, options: ['allow', 'deny'] }),
      );
      expect(e).toMatchObject({ tool: 'install_app', facts });
    });

    it('other asks carry no facts', () => {
      const [e] = make().map('ask', jobAsk({ tool: 'save_preference', input: { a: 1 } }));
      expect(e).not.toHaveProperty('facts');
    });

    it('a where-to-run ask carries the app and body ids onto the card', () => {
      const [e] = make().map(
        'ask',
        jobAsk({
          text: 'Where should Files run: on the brain, or on This PC?',
          options: ['Brain', 'This PC'],
          tool: undefined,
          input: undefined,
          place: { app: 'files', body: 'node-1a2b3c' },
        }),
      );
      expect(e).toMatchObject({ question: true, place: { app: 'files', body: 'node-1a2b3c' } });
    });

    it('an ask without free_text or recommended adds neither field', () => {
      const [e] = make().map('ask', jobAsk());
      expect(e).not.toHaveProperty('freeText');
      expect(e).not.toHaveProperty('recommended');
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

  // A brain ask is dismissed through an event only the bubble handles: Home lists asks from
  // the brain itself, so asks.changed is not the way to take a card down.
  it('a closed ask dismisses just that card and never emits asks.changed', () => {
    const m = make();
    m.map('ask', open());
    m.map('ask', open({ id: 'a2' }));
    expect(m.map('ask', closed('a1'))).toEqual([{ type: 'connector.dismiss', approvalId: 'a1' }]);
    expect(m.map('ask', closed('a2'))).toEqual([{ type: 'connector.dismiss', approvalId: 'a2' }]);
  });

  // A window that opens after the ask arrived (a relaunch, a panel not yet created) missed the
  // card; it pulls the ones still open instead.
  it('openConfirms lists the cards still open, and drops one when its ask closes', () => {
    const m = make();
    const [first] = m.map('ask', open());
    m.map('ask', open({ id: 'a2' }));
    expect(
      m.openConfirms().map((e) => (e.type === 'connector.confirm' ? e.approvalId : '')),
    ).toEqual(['a1', 'a2']);
    expect(m.openConfirms()[0]).toEqual(first);
    m.map('ask', closed('a1'));
    expect(m.openConfirms()).toHaveLength(1);
    m.resync();
    expect(m.openConfirms()).toEqual([]);
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

describe('createTurnEvents joined and blank remarks', () => {
  const brainStart = () => ({ ...turn('started'), events: ['w1'], source: 'timer:t1' });
  const joinedBy = (id: string) => ({ ...turn('joined'), events: [id], source: 'timer:t1' });

  it('a joined wake turn continues as a normal turn with the text so far', () => {
    const m = make('conv-1');
    m.trackSay('s1');
    m.map('turn', brainStart());
    m.map('reply', delta('Time to '));
    expect(m.map('turn', joinedBy('s1'))).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'conv-1' },
      { type: 'turn.delta', turnId: T, text: 'Time to ' },
    ]);
    expect(m.map('reply', delta('stretch.'))).toEqual([
      { type: 'turn.delta', turnId: T, text: 'stretch.' },
    ]);
    const ended = m.map('turn', turn('ended', 'done'));
    expect(ended).toEqual([
      { type: 'turn.completed', turnId: T, text: 'Time to stretch.', stopReason: 'end' },
    ]);
    expect(ended.some((e) => e.type === 'pet.remark')).toBe(false);
  });

  it('joining before any words sends only turn.started', () => {
    const m = make();
    m.trackSay('s1');
    m.map('turn', brainStart());
    expect(m.map('turn', joinedBy('s1'))).toEqual([
      { type: 'turn.started', turnId: T, petId: 'pet-1', conversationId: 'brain' },
    ]);
  });

  it('joining a turn this mapper never saw start sends nothing', () => {
    const m = make();
    m.trackSay('s1');
    expect(m.map('turn', { ...joinedBy('s1'), turn: 'unknown' })).toEqual([]);
  });

  it('a brain-started turn with only whitespace shows nothing', () => {
    const m = make();
    m.map('turn', brainStart());
    m.map('reply', delta(' \n '));
    expect(m.map('turn', turn('ended', 'done'))).toEqual([]);
  });
});

describe('createTurnEvents catching up after a resync', () => {
  const saved = (id: string, text: string, body = 'desktop', role = 'assistant') => ({
    id,
    role,
    text,
    body,
  });

  it('re-reads the chat after a resync', () => {
    const m = make();
    expect(m.chatAnchor()).toBeUndefined(); // an empty chat: the brain sends the last few
    const events = m.caughtUp([saved('7', 'Here is the long answer.')]);
    expect(events).toMatchObject([{ type: 'pet.remark', text: 'Here is the long answer.' }]);
    expect(m.chatAnchor()).toBe('7');
  });

  it('shows a caught-up reply once, over two resyncs', () => {
    const m = make();
    const rows = [saved('7', 'Once only.')];
    expect(m.caughtUp(rows)).toHaveLength(1);
    expect(m.caughtUp(rows)).toEqual([]);
    expect(m.caughtUp([...rows, saved('8', 'Next one.')])).toMatchObject([{ text: 'Next one.' }]);
  });

  it('shows only assistant replies said on the desktop', () => {
    const m = make();
    const rows = [
      saved('6', 'what is the weather', 'desktop', 'user'),
      saved('7', 'On your phone.', 'whatsapp'),
      saved('8', 'Sunny.'),
    ];
    expect(m.caughtUp(rows)).toMatchObject([{ text: 'Sunny.' }]);
    expect(m.chatAnchor()).toBe('8');
  });

  it('shows nothing when the saved chat has nothing new', () => {
    const m = make();
    expect(m.caughtUp([])).toEqual([]);
    m.seen([saved('3', 'Already on screen.')]);
    expect(m.caughtUp([saved('3', 'Already on screen.')])).toEqual([]);
  });

  it('a reply seen live is not shown again, and the anchor never goes back', () => {
    const m = make();
    m.seen([saved('9', 'Streamed to me.')]);
    expect(m.chatAnchor()).toBe('9');
    m.seen([saved('4', 'older')]);
    expect(m.chatAnchor()).toBe('9');
    expect(m.caughtUp([saved('9', 'Streamed to me.'), saved('10', 'Missed.')])).toMatchObject([
      { text: 'Missed.' },
    ]);
  });
});
