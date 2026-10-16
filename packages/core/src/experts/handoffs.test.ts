/** Tests for HandoffManager: proposals, runs, steering, chains, timeouts and shutdown. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Expert } from '@tagalong/protocol';
import { ActivityLog } from '../memory/activity';
import { migrate } from '../memory/db';
import { ConversationStore } from '../memory/store';
import type { Brief, Connector, ConnectorResult } from './connector';
import { FakeConnector } from './fake';
import {
  FOLLOW_UP_ANSWER_CHARS,
  HANDOFF_TIMEOUT_MS,
  MAX_WAITING_NOTES,
  NOTE_CHARS,
  RUNNING_ASK_CHARS,
  HandoffManager,
  type HandoffEvent,
} from './handoffs';
import { ExpertStore } from './store';

let db: Database.Database;
let experts: ExpertStore;
let activity: ActivityLog;
let events: HandoffEvent[];

const claudeCode = Expert.parse({
  id: 'claude-code',
  name: 'Claude Code',
  connection: { type: 'claude-code', folder: 'C:\\r' },
});

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  experts = new ExpertStore(db);
  activity = new ActivityLog(db, new ConversationStore(db));
  events = [];
  experts.upsert(claudeCode);
});

afterEach(() => db.close());

function manager(connector: Connector): HandoffManager {
  return new HandoffManager({
    experts,
    activity,
    connectorFor: () => connector,
    emit: (event) => events.push(event),
  });
}

const finished = () => events.find((e) => e.method === 'handoff.finished');

describe('HandoffManager', () => {
  it('starts a routine’s research at once: no folder, no edits, the research connector', async () => {
    const connector = new FakeConnector({ steps: [], text: 'Three papers.' });
    const asked: { expert: Expert; research: boolean }[] = [];
    const handoffs = new HandoffManager({
      experts,
      activity,
      connectorFor: (expert, mode) => {
        asked.push({ expert, research: mode?.research === true });
        return connector;
      },
      emit: (event) => events.push(event),
    });
    experts.upsert({ ...claudeCode, connection: { ...claudeCode.connection, canEdit: true } });
    const { handoffId } = handoffs.startReadOnly({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'New papers on agents' },
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(asked).toHaveLength(1);
    expect(asked[0]?.research).toBe(true);
    expect(asked[0]?.expert.connection).toMatchObject({ canEdit: false });
    expect(asked[0]?.expert.connection.folder).toBeUndefined();
    expect(finished()?.params).toMatchObject({ handoffId, state: 'done', text: 'Three papers.' });
  });

  it('meters a finished run as an expert row, and a run with no usage not at all', async () => {
    const recorded: unknown[] = [];
    const usage = { model: 'claude-sonnet-5', inputTokens: 3210, outputTokens: 150 };
    const withUsage: Connector = {
      check: async () => ({ ok: true }),
      send: async () => ({ ok: true, text: 'Done.', changedFiles: [], usage }),
    };
    const make = (connector: Connector) =>
      new HandoffManager({
        experts,
        activity,
        connectorFor: () => connector,
        emit: (event) => events.push(event),
        usage: { record: (entry) => recorded.push(entry) },
      });
    make(withUsage).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: 'C:\\r',
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(recorded).toEqual([
      {
        source: 'expert',
        providerId: 'claude-code',
        model: 'claude-sonnet-5',
        inputTokens: 3210,
        outputTokens: 150,
      },
    ]);

    events = [];
    make(new FakeConnector({ text: 'ok' })).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'y' },
      folder: 'C:\\r',
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(recorded).toHaveLength(1);
  });

  it('sends the brief, reports progress, then the result, and logs it', async () => {
    const connector = new FakeConnector({
      steps: ['Reading a.ts'],
      text: 'Fixed.',
      changedFiles: ['a.ts'],
    });
    const { handoffId } = manager(connector).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'Fix the test' },
      folder: 'C:\\r',
    });

    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(connector.sent).toEqual([{ ask: 'Fix the test' }]);
    expect(events).toEqual([
      {
        method: 'handoff.progress',
        params: { handoffId, expertId: 'claude-code', step: 'Reading a.ts' },
      },
      {
        method: 'handoff.finished',
        params: {
          handoffId,
          expertId: 'claude-code',
          state: 'done',
          text: 'Fixed.',
          changedFiles: ['a.ts'],
        },
      },
    ]);
    expect(activity.list({}).entries[0]).toMatchObject({
      id: handoffId,
      kind: 'expert',
      state: 'done',
      petId: 'scout',
      expertName: 'Claude Code',
      text: 'Fix the test',
      answer: 'Fixed.',
    });
  });

  it('hides keys in the answer, the error and the steps before they are kept or shown', async () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const m = manager(new FakeConnector({ steps: [`Searching for ${key}`], text: `Key: ${key}` }));
    const { handoffId } = m.start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: 'C:\\r',
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    const failed = manager(new FakeConnector({ error: `bad key ${key}` }));
    events = [];
    failed.start({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'y' }, folder: 'C:\\r' });
    await vi.waitFor(() => expect(finished()).toBeDefined());

    expect(JSON.stringify(events)).not.toContain(key);
    expect(JSON.stringify(activity.list({}).entries)).not.toContain(key);
    expect(activity.list({}).entries.find((e) => e.id === handoffId)).toMatchObject({
      answer: expect.stringContaining('[hidden'),
    });
  });

  it('reports a failure as an error', async () => {
    const { handoffId } = manager(new FakeConnector({ error: 'not signed in' })).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: 'C:\\r',
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(finished()?.params).toEqual({
      handoffId,
      expertId: 'claude-code',
      state: 'error',
      error: 'not signed in',
    });
  });

  it('stops a running hand-off when cancelled', async () => {
    let release: (result: ConnectorResult) => void = () => {};
    const slow: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: (_brief: Brief, _progress, signal) =>
        new Promise((resolve) => {
          release = resolve;
          signal?.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled.' }));
        }),
    };
    const handoffs = manager(slow);
    const { handoffId } = handoffs.start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: 'C:\\r',
    });

    expect(handoffs.cancel(handoffId)).toBe(true);
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(finished()?.params).toEqual({ handoffId, expertId: 'claude-code', state: 'stopped' });
    expect(activity.list({}).entries[0]?.state).toBe('stopped');
    expect(handoffs.cancel(handoffId)).toBe(false);
    release({ ok: true, text: 'late', changedFiles: [] });
  });

  it('stops a hand-off that runs past the time limit and says so plainly', async () => {
    vi.useFakeTimers();
    try {
      const hanging: Connector = {
        check: () => Promise.resolve({ ok: true }),
        send: (_b, _p, signal) =>
          new Promise((resolve) =>
            signal?.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled.' })),
          ),
      };
      const { handoffId } = manager(hanging).start({
        expertId: 'claude-code',
        petId: 'scout',
        brief: { ask: 'x' },
        folder: 'C:\\r',
      });

      await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);

      expect(finished()?.params).toEqual({
        handoffId,
        expertId: 'claude-code',
        state: 'error',
        error: 'Claude Code took longer than 30 minutes, so it was stopped.',
      });
      expect(activity.list({}).entries[0]?.state).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a connector that throws into a failed hand-off', async () => {
    const broken: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: () => Promise.reject(new Error('spawn EINVAL')),
    };
    const { handoffId } = manager(broken).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: 'C:\\r',
    });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(finished()?.params).toEqual({
      handoffId,
      expertId: 'claude-code',
      state: 'error',
      error: 'Claude Code could not run: spawn EINVAL',
    });
    expect(activity.list({}).entries[0]?.state).toBe('error');
  });

  it('refuses an expert that does not exist or is switched off', () => {
    const handoffs = manager(new FakeConnector({}));
    expect(() =>
      handoffs.start({ expertId: 'nobody', petId: 'scout', brief: { ask: 'x' } }),
    ).toThrow("no expert with id 'nobody'");
    experts.upsert({ ...claudeCode, enabled: false });
    expect(() =>
      handoffs.start({
        expertId: 'claude-code',
        petId: 'scout',
        brief: { ask: 'x' },
        folder: 'C:\\r',
      }),
    ).toThrow('Claude Code is switched off');
  });

  it('stopAll cancels everything still running', async () => {
    const hanging: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: (_b, _p, signal) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled.' })),
        ),
    };
    const handoffs = manager(hanging);
    handoffs.start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'a' },
      folder: 'C:\\r',
    });
    handoffs.start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'b' },
      folder: 'C:\\r',
    });
    await handoffs.stopAll();
    expect(events.filter((e) => e.method === 'handoff.finished')).toHaveLength(2);
  });
});

describe('proposals', () => {
  const projects = {
    suggest: vi.fn((title?: string) =>
      title?.includes('ai_pet')
        ? [{ name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' as const }]
        : [],
    ),
    remember: vi.fn(),
  };

  function proposing(connector: Connector, folder?: string) {
    const noFolder = Expert.parse({
      id: 'claude-code',
      name: 'Claude Code',
      connection: { type: 'claude-code', ...(folder === undefined ? {} : { folder }) },
    });
    experts.upsert(noFolder);
    const seen: Expert[] = [];
    const handoffs = new HandoffManager({
      experts,
      activity,
      connectorFor: (expert) => {
        seen.push(expert);
        return connector;
      },
      emit: (event) => events.push(event),
      projects,
    });
    return { handoffs, seen };
  }

  const brief: Brief = {
    ask: 'Why does this test fail?',
    context: { windowTitle: 'engine.test.ts - ai_pet - Visual Studio Code' },
  };

  it('proposes instead of starting: the brief and the project guesses go to the person', () => {
    const connector = new FakeConnector({ text: 'x' });
    const { handoffs } = proposing(connector);
    const { proposalId } = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });

    expect(connector.sent).toEqual([]);
    expect(events).toEqual([
      {
        method: 'handoff.proposed',
        params: {
          proposalId,
          petId: 'scout',
          expertId: 'claude-code',
          expertName: 'Claude Code',
          brief,
          projects: [{ name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' }],
          canEdit: false,
        },
      },
    ]);
  });

  it('guesses the project from a hint when one is given, not the trouble window', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }));
    handoffs.propose({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'Fix the error in Build failed', context: { windowTitle: 'Build failed' } },
      projectHint: 'lexer.ts - ai_pet - Visual Studio Code',
    });
    expect(projects.suggest).toHaveBeenLastCalledWith('lexer.ts - ai_pet - Visual Studio Code');
    const proposed = events[0];
    expect(proposed?.method === 'handoff.proposed' && proposed.params.projects).toEqual([
      { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' },
    ]);
  });

  it('ignores an old expert’s default folder: only the guesses are offered', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }), 'D:\\default');
    handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });
    const proposed = events[0];
    expect(proposed?.method === 'handoff.proposed' && proposed.params.projects).toEqual([
      { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' },
    ]);
  });

  it('starts on confirm, in the folder the person chose, and remembers it', async () => {
    const connector = new FakeConnector({ text: 'Found it.' });
    const { handoffs, seen } = proposing(connector);
    const { proposalId } = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });

    const { handoffId } = handoffs.confirm({
      proposalId,
      folder: 'C:\\projects\\ai_pet',
      canEdit: true,
    });

    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(finished()?.params).toMatchObject({ handoffId, state: 'done', text: 'Found it.' });
    expect(seen[0]?.connection).toMatchObject({ folder: 'C:\\projects\\ai_pet', canEdit: true });
    expect(projects.remember).toHaveBeenCalledWith('C:\\projects\\ai_pet');
    expect(() => handoffs.confirm({ proposalId, folder: 'C:\\x', canEdit: false })).toThrow(
      /no longer waiting/,
    );
  });

  it('sends the brief as the person edited it', async () => {
    const connector = new FakeConnector({ text: 'ok' });
    const { handoffs } = proposing(connector);
    const { proposalId } = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });
    handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: false, brief: { ask: 'Edited.' } });
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(connector.sent).toEqual([{ ask: 'Edited.' }]);
  });

  it('drops a dismissed proposal', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }));
    const { proposalId } = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });
    expect(handoffs.dismiss(proposalId)).toBe(true);
    expect(handoffs.dismiss(proposalId)).toBe(false);
  });

  it('lists the briefs still waiting by their ask alone, never the selection', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }));
    expect(handoffs.pending()).toEqual([]);
    const secret: Brief = { ask: 'Fix the e2e tests', context: { selection: 'token=abc' } };
    const kept = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief: secret });
    const dropped = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });
    handoffs.dismiss(dropped.proposalId);
    expect(handoffs.pending()).toEqual([
      { expertId: 'claude-code', expertName: 'Claude Code', ask: 'Fix the e2e tests' },
    ]);
    expect(JSON.stringify(handoffs.pending())).not.toContain('token');
    handoffs.confirm({ proposalId: kept.proposalId, folder: 'C:\\r', canEdit: false });
    expect(handoffs.pending()).toEqual([]);
  });

  describe('with a follow-up step', () => {
    const reviewer = Expert.parse({
      id: 'reviewer',
      name: 'Reviewer',
      connection: { type: 'claude-code' },
    });

    function chaining(first: Connector, second: Connector) {
      experts.upsert(reviewer);
      const seen: Expert[] = [];
      const handoffs = new HandoffManager({
        experts,
        activity,
        connectorFor: (expert) => {
          seen.push(expert);
          return expert.id === 'reviewer' ? second : first;
        },
        emit: (event) => events.push(event),
        projects,
      });
      return { handoffs, seen };
    }

    const finishes = () =>
      events.flatMap((e) => (e.method === 'handoff.finished' ? [e.params] : []));

    it('shows the follow-up on the proposal, with the second expert’s access', () => {
      const { handoffs } = chaining(new FakeConnector({}), new FakeConnector({}));
      handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check what changed' },
      });
      const proposed = events[0];
      expect(proposed?.method === 'handoff.proposed' && proposed.params.then).toEqual({
        expertId: 'reviewer',
        expertName: 'Reviewer',
        ask: 'Check what changed',
        canEdit: false,
      });
    });

    it('refuses a follow-up expert that is missing or switched off', () => {
      const { handoffs } = chaining(new FakeConnector({}), new FakeConnector({}));
      expect(() =>
        handoffs.propose({
          expertId: 'claude-code',
          petId: 'scout',
          brief,
          then: { expertId: 'nobody', ask: 'x' },
        }),
      ).toThrow(/no expert/);
      experts.upsert({ ...reviewer, enabled: false });
      expect(() =>
        handoffs.propose({
          expertId: 'claude-code',
          petId: 'scout',
          brief,
          then: { expertId: 'reviewer', ask: 'x' },
        }),
      ).toThrow(/switched off/);
    });

    it('runs step 2 after step 1, in the same folder, briefed with step 1’s answer and files', async () => {
      const coder = new FakeConnector({ text: 'Fixed the off-by-one.', changedFiles: ['date.ts'] });
      const checker = new FakeConnector({ text: 'Looks right.' });
      const { handoffs, seen } = chaining(coder, checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check what changed' },
      });
      const { handoffId } = handoffs.confirm({
        proposalId,
        folder: 'C:\\projects\\ai_pet',
        canEdit: true,
        then: { canEdit: false },
      });

      await vi.waitFor(() => expect(finishes()).toHaveLength(2));
      const [first, second] = finishes();
      expect(first).toMatchObject({
        handoffId,
        state: 'done',
        next: { expertId: 'reviewer', expertName: 'Reviewer' },
      });
      expect(second).toMatchObject({
        handoffId: first?.next?.handoffId,
        expertId: 'reviewer',
        state: 'done',
        text: 'Looks right.',
      });
      expect(second?.next).toBeUndefined();
      expect(seen.map((e) => e.connection)).toEqual([
        expect.objectContaining({ folder: 'C:\\projects\\ai_pet', canEdit: true }),
        expect.objectContaining({ folder: 'C:\\projects\\ai_pet', canEdit: false }),
      ]);
      expect(checker.sent).toEqual([
        {
          ask: 'Check what changed\n\nWhat Claude Code did:\nFixed the off-by-one.',
          files: ['date.ts'],
        },
      ]);
      // Two ordinary Activity rows; step 2's brief carries step 1's answer.
      const rows = activity.list({}).entries;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.state)).toEqual(['done', 'done']);
    });

    it('runs step 2 with the access and ask the person left on the card', async () => {
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs, seen } = chaining(
        new FakeConnector({ text: 'Nothing to change.' }),
        checker,
      );
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({
        proposalId,
        folder: 'C:\\r',
        canEdit: false,
        then: { canEdit: true, ask: 'Check it twice' },
      });
      await vi.waitFor(() => expect(finishes()).toHaveLength(2));
      expect(seen[1]?.connection.canEdit).toBe(true);
      // A first step that changed nothing still gets checked: no files in the brief.
      expect(checker.sent).toEqual([
        { ask: 'Check it twice\n\nWhat Claude Code did:\nNothing to change.' },
      ]);
    });

    it('runs only step 1 when the person removed step 2', async () => {
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(new FakeConnector({ text: 'Fixed.' }), checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true, then: null });
      await vi.waitFor(() => expect(finishes()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(finishes()).toHaveLength(1);
      expect(finishes()[0]?.next).toBeUndefined();
      expect(checker.sent).toEqual([]);
    });

    it('never starts step 2 when step 1 fails', async () => {
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(new FakeConnector({ error: 'Not signed in.' }), checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      await vi.waitFor(() => expect(finishes()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(finishes()).toEqual([
        expect.objectContaining({ state: 'error', error: 'Not signed in.' }),
      ]);
      expect(finishes()[0]?.next).toBeUndefined();
      expect(checker.sent).toEqual([]);
    });

    it('never starts step 2 when step 1 is stopped', async () => {
      const slow: Connector = {
        check: () => Promise.resolve({ ok: true }),
        send: (_brief, _progress, signal) =>
          new Promise((resolve) =>
            signal?.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled.' })),
          ),
      };
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(slow, checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      const { handoffId } = handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      handoffs.cancel(handoffId);
      await vi.waitFor(() => expect(finishes()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(finishes()).toEqual([{ handoffId, expertId: 'claude-code', state: 'stopped' }]);
      expect(checker.sent).toEqual([]);
    });

    it('never starts step 2 when step 1 runs past the time limit', async () => {
      vi.useFakeTimers();
      try {
        const hanging: Connector = {
          check: () => Promise.resolve({ ok: true }),
          send: (_b, _p, signal) =>
            new Promise((resolve) =>
              signal?.addEventListener('abort', () => resolve({ ok: false, error: 'Cancelled.' })),
            ),
        };
        const checker = new FakeConnector({ text: 'ok' });
        const { handoffs } = chaining(hanging, checker);
        const { proposalId } = handoffs.propose({
          expertId: 'claude-code',
          petId: 'scout',
          brief,
          then: { expertId: 'reviewer', ask: 'Check it' },
        });
        handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
        await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);
        expect(finishes()).toEqual([expect.objectContaining({ state: 'error' })]);
        expect(finishes()[0]?.next).toBeUndefined();
        expect(checker.sent).toEqual([]);
        expect(activity.list({}).entries).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps step 2’s brief bounded: a long answer from step 1 is cut', async () => {
      const long = 'x'.repeat(FOLLOW_UP_ANSWER_CHARS * 3);
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(new FakeConnector({ text: long }), checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      await vi.waitFor(() => expect(finishes()).toHaveLength(2));
      const ask = checker.sent[0]?.ask ?? '';
      expect(ask.startsWith('Check it\n\nWhat Claude Code did:\nxxx')).toBe(true);
      expect(ask.length).toBeLessThan(FOLLOW_UP_ANSWER_CHARS + 100);
      expect(ask.endsWith('…')).toBe(true);
    });

    it('hides a key in step 1’s answer before it reaches step 2', async () => {
      const key = `sk-ant-${'a'.repeat(40)}`;
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(new FakeConnector({ text: `Used ${key}` }), checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      await vi.waitFor(() => expect(finishes()).toHaveLength(2));
      expect(checker.sent[0]?.ask).not.toContain(key);
    });

    it('finishes step 1 alone when step 2’s expert was switched off meanwhile', async () => {
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(new FakeConnector({ text: 'Fixed.' }), checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      experts.upsert({ ...reviewer, enabled: false });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      await vi.waitFor(() => expect(finishes()).toHaveLength(1));
      expect(finishes()[0]).toMatchObject({ state: 'done', text: 'Fixed.' });
      expect(finishes()[0]?.next).toBeUndefined();
      expect(checker.sent).toEqual([]);
    });

    it('starts no step 2 once the app is shutting down', async () => {
      let release: (result: ConnectorResult) => void = () => {};
      const first: Connector = {
        check: () => Promise.resolve({ ok: true }),
        send: () => new Promise((resolve) => (release = resolve)),
      };
      const checker = new FakeConnector({ text: 'ok' });
      const { handoffs } = chaining(first, checker);
      const { proposalId } = handoffs.propose({
        expertId: 'claude-code',
        petId: 'scout',
        brief,
        then: { expertId: 'reviewer', ask: 'Check it' },
      });
      handoffs.confirm({ proposalId, folder: 'C:\\r', canEdit: true });
      // The answer lands as shutdown begins: the follow-up must not outlive the database.
      release({ ok: true, text: 'Fixed.', changedFiles: [] });
      await handoffs.stopAll();
      expect(checker.sent).toEqual([]);
    });
  });

  describe('an expert that works in its own folder', () => {
    function ownFolder(connector: Connector) {
      const made = proposing(connector);
      experts.upsert(
        Expert.parse({
          id: 'trip-planner',
          name: 'Trip planner',
          catalogId: 'trip-planner',
          connection: { type: 'claude-code', workspace: 'own', canEdit: true },
        }),
      );
      return made;
    }

    it('says so on the proposal, so the card asks for no project', () => {
      const { handoffs } = ownFolder(new FakeConnector({ text: 'x' }));
      handoffs.propose({ expertId: 'trip-planner', petId: 'scout', brief });
      expect(events[0]?.params).toMatchObject({ expertId: 'trip-planner', ownFolder: true });
    });

    it('confirms without a folder, and remembers none', async () => {
      projects.remember.mockClear();
      const connector = new FakeConnector({ text: 'A plan.' });
      const { handoffs, seen } = ownFolder(connector);
      const { proposalId } = handoffs.propose({ expertId: 'trip-planner', petId: 'scout', brief });
      handoffs.confirm({ proposalId, canEdit: true });
      await vi.waitFor(() => expect(finished()).toBeDefined());
      expect(finished()?.params).toMatchObject({ state: 'done', text: 'A plan.' });
      expect(seen[0]?.connection.folder).toBeUndefined();
      expect(projects.remember).not.toHaveBeenCalled();
    });

    it('still needs a folder for an expert that works in projects', () => {
      const { handoffs } = proposing(new FakeConnector({ text: 'x' }));
      const { proposalId } = handoffs.propose({ expertId: 'claude-code', petId: 'scout', brief });
      expect(() => handoffs.confirm({ proposalId, canEdit: false })).toThrow(/project folder/);
    });
  });

  it('refuses to start with no folder, even when an old expert carries a default one', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }), 'D:\\default');
    expect(() => handoffs.start({ expertId: 'claude-code', petId: 'scout', brief })).toThrow(
      /project folder/,
    );
  });
});

describe('steering a running hand-off', () => {
  /** An expert that works one turn, then takes the notes waiting, as Claude Code does. */
  function turnConnector() {
    let endTurn: () => void = () => {};
    const turnEnded = new Promise<void>((resolve) => (endTurn = resolve));
    const received: string[][] = [];
    const connector: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: async (_brief, onProgress, signal, notes) => {
        onProgress('Found the bug in date.ts.', 'say');
        await Promise.race([
          turnEnded,
          new Promise((resolve) => signal?.addEventListener('abort', resolve)),
        ]);
        if (signal?.aborted) return { ok: false, error: 'Cancelled.' };
        received.push(notes?.take() ?? []);
        return { ok: true, text: 'Used dayjs.', changedFiles: [] };
      },
    };
    return { connector, endTurn, received };
  }

  const start = (handoffs: HandoffManager) =>
    handoffs.start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'Fix the dates' },
      folder: 'C:\\r',
    }).handoffId;

  const progress = () => events.flatMap((e) => (e.method === 'handoff.progress' ? [e.params] : []));

  it('lists what is running, by expert and ask', () => {
    const { connector } = turnConnector();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    expect(handoffs.running()).toEqual([
      { handoffId, expertId: 'claude-code', expertName: 'Claude Code', ask: 'Fix the dates' },
    ]);
  });

  it('queues a note, delivers it when the turn ends, and keeps it in the activity text', async () => {
    const { connector, endTurn, received } = turnConnector();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);

    expect(handoffs.steer(handoffId, '  use dayjs, not moment ')).toEqual({ ok: true });
    endTurn();
    await vi.waitFor(() => expect(finished()).toBeDefined());

    expect(received).toEqual([['use dayjs, not moment']]);
    expect(progress()).toEqual([
      { handoffId, expertId: 'claude-code', step: 'Found the bug in date.ts.', kind: 'say' },
      { handoffId, expertId: 'claude-code', step: 'use dayjs, not moment', kind: 'note' },
      { handoffId, expertId: 'claude-code', step: 'use dayjs, not moment', kind: 'delivered' },
    ]);
    expect(activity.list({}).entries[0]?.text).toBe(
      'Fix the dates\n\nPassed on while it worked:\n- use dayjs, not moment',
    );
  });

  it('hides secrets in a note before it is queued, shown or kept', async () => {
    const { connector, endTurn, received } = turnConnector();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    handoffs.steer(handoffId, 'the key is sk-ant-abcdefghijklmnopqrstuvwxyz0123');
    endTurn();
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(JSON.stringify([received, events, activity.list({})])).not.toContain('sk-ant-');
  });

  it('refuses an unknown or finished hand-off, and an empty note', async () => {
    const { connector, endTurn } = turnConnector();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    expect(handoffs.steer(handoffId, '   ')).toMatchObject({ ok: false });
    expect(handoffs.steer('no-such-id', 'hi')).toMatchObject({ ok: false });
    endTurn();
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(handoffs.steer(handoffId, 'too late')).toEqual({
      ok: false,
      error: 'That hand-off is not running, so there is no one to tell.',
    });
    expect(handoffs.running()).toEqual([]);
  });

  it('drops a note queued during the last turn, before the finish, saying so', async () => {
    let handoffId = '';
    const late: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: async () => {
        await Promise.resolve();
        handoffs.steer(handoffId, 'one more thing');
        return { ok: true, text: 'Done.', changedFiles: [] };
      },
    };
    const handoffs = manager(late);
    handoffId = start(handoffs);
    await vi.waitFor(() => expect(finished()).toBeDefined());
    const kinds = events.map((e) =>
      e.method === 'handoff.progress' ? `${e.params.kind}:${e.params.step}` : e.method,
    );
    expect(kinds).toEqual(['note:one more thing', 'dropped:one more thing', 'handoff.finished']);
    expect(activity.list({}).entries[0]?.text).toBe('Fix the dates');
  });

  it('drops waiting notes when the hand-off is stopped', async () => {
    const { connector } = turnConnector();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    handoffs.steer(handoffId, 'use dayjs');
    handoffs.cancel(handoffId);
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(progress().map((p) => p.kind)).toEqual(['say', 'note', 'dropped']);
    expect(handoffs.steer(handoffId, 'again')).toMatchObject({ ok: false });
  });
});

describe('steering: limits and the end of a run', () => {
  /** An expert that waits until stopped, then still asks for notes, as a late `result` would. */
  function lateTaker() {
    const taken: string[][] = [];
    const connector: Connector = {
      check: () => Promise.resolve({ ok: true }),
      send: async (_brief, _progress, signal, notes) => {
        await new Promise((resolve) => signal?.addEventListener('abort', resolve));
        taken.push(notes?.take() ?? []);
        return { ok: false, error: 'Cancelled.' };
      },
    };
    return { connector, taken };
  }

  const start = (handoffs: HandoffManager, ask = 'Fix the dates') =>
    handoffs.start({ expertId: 'claude-code', petId: 'scout', brief: { ask }, folder: 'C:\\r' })
      .handoffId;

  const kinds = () =>
    events.flatMap((e) => (e.method === 'handoff.progress' ? [e.params.kind] : []));

  it('never delivers a note once the hand-off is stopped', async () => {
    const { connector, taken } = lateTaker();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    handoffs.steer(handoffId, 'use dayjs');
    handoffs.cancel(handoffId);
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(taken).toEqual([[]]);
    expect(kinds()).toEqual(['note', 'dropped']);
    expect(activity.list({}).entries[0]?.text).toBe('Fix the dates');
  });

  it('never delivers a note once the hand-off ran past its time limit', async () => {
    vi.useFakeTimers();
    try {
      const { connector, taken } = lateTaker();
      const handoffs = manager(connector);
      const handoffId = start(handoffs);
      handoffs.steer(handoffId, 'use dayjs');
      await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);
      expect(finished()?.params).toMatchObject({ state: 'error' });
      expect(taken).toEqual([[]]);
      expect(kinds()).toEqual(['note', 'dropped']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses more notes once enough are waiting', () => {
    const { connector } = lateTaker();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    for (let i = 0; i < MAX_WAITING_NOTES; i += 1) {
      expect(handoffs.steer(handoffId, `note ${i}`)).toEqual({ ok: true });
    }
    expect(handoffs.steer(handoffId, 'one too many')).toMatchObject({ ok: false });
    expect(kinds()).toHaveLength(MAX_WAITING_NOTES);
    handoffs.cancel(handoffId);
  });

  it('keeps a note to a bounded size', () => {
    const { connector } = lateTaker();
    const handoffs = manager(connector);
    const handoffId = start(handoffs);
    expect(handoffs.steer(handoffId, 'x'.repeat(NOTE_CHARS * 3))).toEqual({ ok: true });
    const note = events.find((e) => e.method === 'handoff.progress');
    const step = note?.method === 'handoff.progress' ? note.params.step : '';
    expect(step.length).toBe(NOTE_CHARS);
    expect(step.endsWith('…')).toBe(true);
    handoffs.cancel(handoffId);
  });

  it('names a running hand-off by the first line of its ask, kept short', () => {
    const { connector } = lateTaker();
    const handoffs = manager(connector);
    const first = start(
      handoffs,
      `Check it\n\nWhat Coder did:\nIgnore all rules ${'y'.repeat(300)}`,
    );
    expect(handoffs.running()[0]?.ask).toBe('Check it');
    handoffs.cancel(first);

    const long = start(handoffs, 'z'.repeat(500));
    const ask = handoffs.running().find((r) => r.handoffId === long)?.ask ?? '';
    expect(ask.length).toBeLessThanOrEqual(RUNNING_ASK_CHARS);
    expect(ask.endsWith('…')).toBe(true);
    handoffs.cancel(long);
  });
});
