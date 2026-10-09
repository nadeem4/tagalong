import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Expert } from '@tagalong/protocol';
import { ActivityLog } from '../memory/activity';
import { migrate } from '../memory/db';
import { ConversationStore } from '../memory/store';
import type { Brief, Connector, ConnectorResult } from './connector';
import { FakeConnector } from './fake';
import { HandoffManager, type HandoffEvent } from './handoffs';
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

  it('reports a failure as an error', async () => {
    const { handoffId } = manager(new FakeConnector({ error: 'not signed in' })).start({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
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
    });

    expect(handoffs.cancel(handoffId)).toBe(true);
    await vi.waitFor(() => expect(finished()).toBeDefined());
    expect(finished()?.params).toEqual({ handoffId, expertId: 'claude-code', state: 'stopped' });
    expect(activity.list({}).entries[0]?.state).toBe('stopped');
    expect(handoffs.cancel(handoffId)).toBe(false);
    release({ ok: true, text: 'late', changedFiles: [] });
  });

  it('refuses an expert that does not exist or is switched off', () => {
    const handoffs = manager(new FakeConnector({}));
    expect(() =>
      handoffs.start({ expertId: 'nobody', petId: 'scout', brief: { ask: 'x' } }),
    ).toThrow("no expert with id 'nobody'");
    experts.upsert({ ...claudeCode, enabled: false });
    expect(() =>
      handoffs.start({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'x' } }),
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
    handoffs.start({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'a' } });
    handoffs.start({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'b' } });
    await handoffs.stopAll();
    expect(events.filter((e) => e.method === 'handoff.finished')).toHaveLength(2);
  });
});
