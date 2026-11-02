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
  });
  return { ...ipc, calls };
}

describe('setup IPC', () => {
  it('setupOverview maps the brain JSON to SetupOverview', async () => {
    const { invoke } = setup(() => text(OVERVIEW));
    const overview = (await invoke(IPC.setupOverview)) as { browseExperts: { id: string }[] };
    expect(overview.browseExperts[0]?.id).toBe('codex-acp');
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

  it('setupApp always opens the card, even from the tour', async () => {
    const { invokeWith, calls } = setup(() => text({}));
    await invokeWith(TOUR, IPC.setupApp, 'acme/cloud', true);
    expect(calls).toEqual([['setup_app', { id: 'acme/cloud', approved: false }]]);
  });

  it('the channels validate their arguments', async () => {
    const { invoke, calls } = setup(() => text({}));
    await expect(invoke(IPC.setupExpert, '', true)).rejects.toThrow();
    await expect(invoke(IPC.setupExpert, 'x', 'yes')).rejects.toThrow();
    await expect(invoke(IPC.setupApp, 5, false)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('a refusal the brain reports comes back as the result', async () => {
    const { invoke } = setup(() => text({ error: 'denied' }));
    await expect(invoke(IPC.setupExpert, 'x', false)).resolves.toEqual({ error: 'denied' });
  });
});
