/** Tests for the Home and hand-off IPC. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerExpertIpc } from './experts';

const EXPERT = { id: 'claude-code', name: 'Claude Code' };

let spend: () => unknown = () => [];
const spendText = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];

function setup() {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'activity.list': { items: [] },
    'experience.list': { episodes: [] },
    'experience.get': null,
    'experience.clear': { deleted: 4 },
    'self.list': { pages: [], nights: [] },
    'self.get': null,
    'self.write': { ok: true },
    'self.undo': { ok: true },
    'self.accept': { ok: true },
    'self.reject': { ok: true },
    'experts.list': { experts: [EXPERT] },
    'experts.upsert': { expert: EXPERT },
    'experts.delete': { deleted: true },
    'experts.test': { ok: true },
    'handoffs.confirm': { handoffId: 'h1' },
    'experts.catalog': { entries: [{ entry: { id: 'researcher' } }] },
    'experts.install': { ok: true, installed: ['firecrawl@claude-plugins-official'] },
    'projects.search': { projects: ['C:\\code\\app'] },
  });
  const brainCalls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      brainCalls.push([tool, input]);
      return Promise.resolve(spend() as never);
    },
  };
  registerExpertIpc(ipc.handle, { engine: () => engine.client, brain });
  return { ...ipc, calls: engine.calls, brainCalls };
}

describe('registerExpertIpc', () => {
  it("lists Home's activity, thirty at a time unless asked otherwise", async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listActivity, {})).toEqual({ items: [] });
    await invoke(IPC.listActivity, { before: 'a9', limit: 5 });
    expect(calls).toEqual([
      ['activity.list', { limit: 30 }],
      ['activity.list', { limit: 5, before: 'a9' }],
    ]);
  });

  it("lists Home's decisions thirty at a time, and reads one when it is opened", async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listExperience, {})).toEqual({ episodes: [] });
    await invoke(IPC.listExperience, { before: 'e9', limit: 5 });
    expect(await invoke(IPC.getExperience, 'e1')).toBeNull();
    expect(calls).toEqual([
      ['experience.list', { limit: 30 }],
      ['experience.list', { limit: 5, before: 'e9' }],
      ['experience.get', { id: 'e1' }],
    ]);
  });

  it("deletes all of Home's decisions, and says how many went", async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.clearExperience)).toBe(4);
    expect(calls).toEqual([['experience.clear', {}]]);
  });

  it("reads, edits, undoes, accepts and rejects Scout's notes for What Scout learned", async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listSelf)).toEqual({ pages: [], nights: [] });
    await invoke(IPC.getSelf, 'you.md');
    expect(await invoke(IPC.writeSelf, 'you.md', 'Works on Tagalong.')).toEqual({ ok: true });
    await invoke(IPC.undoSelf, 7);
    expect(await invoke(IPC.acceptSelf, 8)).toEqual({ ok: true });
    expect(await invoke(IPC.rejectSelf, 9)).toEqual({ ok: true });
    expect(calls).toEqual([
      ['self.list', {}],
      ['self.get', { path: 'you.md' }],
      ['self.write', { path: 'you.md', text: 'Works on Tagalong.' }],
      ['self.undo', { versionId: 7 }],
      ['self.accept', { versionId: 8 }],
      ['self.reject', { versionId: 9 }],
    ]);
  });

  it("reads Home's Spend card from the brain's spend_today", async () => {
    spend = () => spendText({ spent_usd: 0.31, limit_usd: 1 });
    const { invoke, calls, brainCalls } = setup();
    expect(await invoke(IPC.usageSummary)).toEqual({ spentUsd: 0.31, limitUsd: 1 });
    expect(brainCalls).toEqual([['spend_today', {}]]);
    expect(calls).toEqual([]);
  });

  it('shows no limit when the brain has none, and rejects an answer it cannot read', async () => {
    spend = () => spendText({ spent_usd: 0, limit_usd: null });
    expect(await setup().invoke(IPC.usageSummary)).toEqual({ spentUsd: 0, limitUsd: null });
    spend = () => spendText({ nope: true });
    await expect(setup().invoke(IPC.usageSummary)).rejects.toThrow('brain sent bad spend');
  });

  it('lists, saves, deletes and tests experts, unwrapping each answer', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listExperts)).toEqual([EXPERT]);
    expect(await invoke(IPC.saveExpert, EXPERT)).toEqual(EXPERT);
    expect(await invoke(IPC.deleteExpert, 'claude-code')).toBe(true);
    expect(await invoke(IPC.testExpert, 'claude-code')).toEqual({ ok: true });
    expect(calls).toEqual([
      ['experts.list', {}],
      ['experts.upsert', { expert: EXPERT }],
      ['experts.delete', { expertId: 'claude-code' }],
      ['experts.test', { expertId: 'claude-code' }],
    ]);
  });

  it('lists the expert catalog and installs an entry, unwrapping each answer', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.expertCatalog)).toEqual([{ entry: { id: 'researcher' } }]);
    expect(await invoke(IPC.installExpert, 'researcher')).toEqual({
      ok: true,
      installed: ['firecrawl@claude-plugins-official'],
    });
    expect(calls).toEqual([
      ['experts.catalog', {}],
      ['experts.install', { catalogId: 'researcher' }],
    ]);
  });

  it('confirms, dismisses and cancels hand-offs, and searches projects', async () => {
    const { invoke, calls } = setup();
    const confirm = { proposalId: 'p1', expertId: 'claude-code', brief: 'Fix it' };
    expect(await invoke(IPC.confirmHandoff, confirm)).toEqual({ handoffId: 'h1' });
    expect(await invoke(IPC.dismissHandoff, 'p1')).toBeUndefined();
    expect(await invoke(IPC.cancelHandoff, 'h1')).toBeUndefined();
    expect(await invoke(IPC.searchProjects, 'app')).toEqual(['C:\\code\\app']);
    expect(calls).toEqual([
      ['handoffs.confirm', confirm],
      ['handoffs.dismiss', { proposalId: 'p1' }],
      ['handoffs.cancel', { handoffId: 'h1' }],
      ['projects.search', { query: 'app' }],
    ]);
  });
});
