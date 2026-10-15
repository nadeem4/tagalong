import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Expert } from '@tagalong/protocol';
import { ActivityLog } from '../memory/activity';
import { migrate } from '../memory/db';
import { ConversationStore } from '../memory/store';
import type { Brief, Connector, ConnectorResult } from './connector';
import { FakeConnector } from './fake';
import { HANDOFF_TIMEOUT_MS, HandoffManager, type HandoffEvent } from './handoffs';
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

  it('refuses to start with no folder, even when an old expert carries a default one', () => {
    const { handoffs } = proposing(new FakeConnector({ text: 'x' }), 'D:\\default');
    expect(() => handoffs.start({ expertId: 'claude-code', petId: 'scout', brief })).toThrow(
      /project folder/,
    );
  });
});
