/** Tests for the setup IPC: the Connections page and the tour call the brain's setup tools. */

import { BrainOffline } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerSetupIpc } from './setup';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const OVERVIEW = {
  experts: [{ id: 'claude-acp', name: 'Claude Code', version: '2', state: 'ready', tested: true }],
  apps: [],
  browse_experts: [{ id: 'codex-acp', name: 'Codex', version: '1', description: 'd' }],
  browse_apps: [],
  stale: false,
  progress: null,
  failed: null,
};

const TOUR = { sender: 'tour' };
const HOME = { sender: 'home' };

function setup(answer: (tool: string, input?: object) => unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  registerSetupIpc(ipc.handle, {
    brain,
    fromTour: (event) => (event as { sender?: string }).sender === 'tour',
    fromHome: (event) => (event as { sender?: string }).sender === 'home',
  });
  return { ...ipc, calls };
}

describe('setup IPC', () => {
  it('setupOverview maps the brain JSON to SetupOverview', async () => {
    const { invoke } = setup(() => text(OVERVIEW));
    const overview = (await invoke(IPC.setupOverview)) as { browseExperts: { id: string }[] };
    expect(overview.browseExperts[0]?.id).toBe('codex-acp');
  });

  it('setupOverview passes a query on, and only a string one', async () => {
    const { invoke, calls } = setup(() => text(OVERVIEW));
    await invoke(IPC.setupOverview);
    await invoke(IPC.setupOverview, 'gmail');
    await expect(invoke(IPC.setupOverview, 5)).rejects.toThrow();
    expect(calls).toEqual([
      ['setup_overview', {}],
      ['setup_overview', { query: 'gmail' }],
    ]);
  });

  it('setupApp passes the search query the app was found with', async () => {
    const { invoke, calls } = setup(() => text({}));
    await invoke(IPC.setupApp, 'acme/cloud', false, 'gmail');
    await invoke(IPC.setupApp, 'acme/cloud', false);
    expect(calls).toEqual([
      ['setup_app', { id: 'acme/cloud', approved: false, query: 'gmail' }],
      ['setup_app', { id: 'acme/cloud', approved: false }],
    ]);
  });

  it('a brain error maps to the offline failure', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.setupOverview)).rejects.toThrow(/offline/);
  });

  it('the tour window may send approved true for an expert', async () => {
    const { invokeWith, calls } = setup(() => text({ started: 'claude-acp' }));
    await invokeWith(TOUR, IPC.setupExpert, 'claude-acp', true);
    expect(calls).toEqual([['setup_expert', { id: 'claude-acp', approved: true }]]);
  });

  it('no other window can send approved true: it goes to the brain as false', async () => {
    const { invokeWith, invoke, calls } = setup(() => text({}));
    await invokeWith(HOME, IPC.setupExpert, 'claude-acp', true);
    await invoke(IPC.setupExpert, 'claude-acp', true);
    expect(calls).toEqual([
      ['setup_expert', { id: 'claude-acp', approved: false }],
      ['setup_expert', { id: 'claude-acp', approved: false }],
    ]);
  });

  it('the Home window may approve an app; no other window can', async () => {
    const { invokeWith, calls } = setup(() => text({}));
    await invokeWith(HOME, IPC.setupApp, 'acme/cloud', true);
    await invokeWith(TOUR, IPC.setupApp, 'acme/cloud', true);
    expect(calls).toEqual([
      ['setup_app', { id: 'acme/cloud', approved: true }],
      ['setup_app', { id: 'acme/cloud', approved: false }],
    ]);
  });

  it('communityOk is forwarded as community_ok only from Home', async () => {
    const { invokeWith, calls } = setup(() => text({}));
    await invokeWith(HOME, IPC.setupApp, 'a/b', true, 'q', true);
    await invokeWith(TOUR, IPC.setupApp, 'a/b', true, 'q', true);
    expect(calls).toEqual([
      ['setup_app', { id: 'a/b', approved: true, query: 'q', community_ok: true }],
      ['setup_app', { id: 'a/b', approved: false, query: 'q' }],
    ]);
  });

  it('setupOverview forwards the cursor', async () => {
    const { invoke, calls } = setup(() => text(OVERVIEW));
    await invoke(IPC.setupOverview, 'gmail', 'c2');
    expect(calls).toEqual([['setup_overview', { query: 'gmail', cursor: 'c2' }]]);
  });

  it('an expert approval is the tour alone, unless Home sends communityOk', async () => {
    const { invokeWith, calls } = setup(() => text({}));
    await invokeWith(HOME, IPC.setupExpert, 'x', true);
    await invokeWith(HOME, IPC.setupExpert, 'x', true, true);
    expect(calls).toEqual([
      ['setup_expert', { id: 'x', approved: false }],
      ['setup_expert', { id: 'x', approved: true, community_ok: true }],
    ]);
  });

  it('the channels validate their arguments', async () => {
    const { invoke, calls } = setup(() => text({}));
    await expect(invoke(IPC.setupExpert, '', true)).rejects.toThrow();
    await expect(invoke(IPC.setupExpert, 'x', 'yes')).rejects.toThrow();
    await expect(invoke(IPC.setupApp, 5, false)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('updatesState and updatesCheck read the brain and parse the answer', async () => {
    const state = {
      checkedAt: null,
      auto: {
        apps: { official: true, community: false },
        experts: { official: true, community: false },
      },
      items: [],
    };
    const { invoke, calls } = setup(() => text(state));
    await expect(invoke(IPC.updatesState)).resolves.toEqual(state);
    await invoke(IPC.updatesCheck);
    expect(calls).toEqual([
      ['updates_state', {}],
      ['updates_check', {}],
    ]);
  });

  it('updateItem, updateAll and setAutoUpdate pass checked arguments to the brain', async () => {
    const { invoke, calls } = setup(() => text({ started: true }));
    await expect(invoke(IPC.updateItem, 'app', 'github')).resolves.toEqual({ started: true });
    await invoke(IPC.updateAll, 'expert');
    await invoke(IPC.setAutoUpdate, 'app', false, true);
    expect(calls).toEqual([
      ['update_item', { kind: 'app', id: 'github' }],
      ['update_all', { kind: 'expert' }],
      ['set_auto_update', { kind: 'app', official: false, on: true }],
    ]);
  });

  it('the update channels validate their arguments', async () => {
    const { invoke, calls } = setup(() => text({}));
    await expect(invoke(IPC.updateItem, 'thing', 'x')).rejects.toThrow();
    await expect(invoke(IPC.updateItem, 'app', '')).rejects.toThrow();
    await expect(invoke(IPC.updateAll, 'x')).rejects.toThrow();
    await expect(invoke(IPC.setAutoUpdate, 'app', 'no', true)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('a refusal the brain reports comes back as the result', async () => {
    const { invoke } = setup(() => text({ error: 'denied' }));
    await expect(invoke(IPC.setupExpert, 'x', false)).resolves.toEqual({ error: 'denied' });
  });
});
