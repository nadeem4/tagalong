import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerExpertIpc } from './experts';

const EXPERT = { id: 'claude-code', name: 'Claude Code' };

function setup() {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'activity.list': { items: [] },
    'experts.list': { experts: [EXPERT] },
    'experts.upsert': { expert: EXPERT },
    'experts.delete': { deleted: true },
    'experts.test': { ok: true },
    'handoffs.confirm': { handoffId: 'h1' },
    'experts.catalog': { entries: [{ entry: { id: 'researcher' } }] },
    'experts.install': { ok: true, installed: ['firecrawl@claude-plugins-official'] },
    'projects.search': { projects: ['C:\\code\\app'] },
    'usage.summary': { today: [], month: [] },
  });
  registerExpertIpc(ipc.handle, { engine: () => engine.client });
  return { ...ipc, calls: engine.calls };
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

  it("reads Home's Spend card from the engine as it is", async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.usageSummary)).toEqual({ today: [], month: [] });
    expect(calls).toEqual([['usage.summary', {}]]);
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
