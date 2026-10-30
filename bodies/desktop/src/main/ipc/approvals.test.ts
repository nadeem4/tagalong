/** Tests for the Approvals IPC: the history and the preferences Scout follows, through the brain. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '@tagalong/contract';
import { registerApprovalsIpc } from './approvals';
import { fakeIpc } from './fake-ipc';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup(answer: (tool: string, input?: object) => Promise<unknown> | unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  registerApprovalsIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

// The brain's row as it sends it: snake_case, with fields Home does not show.
const BRAIN_ROW = {
  id: 7,
  source: 'claude_code',
  tool: 'Bash',
  summary: 'run the tests',
  input: { command: 'pnpm test' },
  job_id: 'j1',
  outcome: 'approved',
  decided_by: 'scout',
  preference_id: 3,
  preference: 'Let tests run',
  at: '2026-10-28T10:00:00Z',
};

const BRAIN_PREF = {
  id: 3,
  sentence: 'Let tests run',
  source: 'claude_code',
  tool: null,
  builtin: false,
  created_at: '2026-10-27T09:00:00Z',
  use_count: 4,
  last_used: '2026-10-28T10:00:00Z',
};

describe('registerApprovalsIpc', () => {
  it('maps a brain approvals row to camelCase', async () => {
    const { invoke, calls } = setup(() =>
      text({ approvals: [BRAIN_ROW], counts: { total: 9, scout: 2, refused: 1 }, next: 7 }),
    );
    expect(await invoke(IPC.listApprovals, 'scout', 12)).toEqual({
      approvals: [
        {
          id: 7,
          source: 'claude_code',
          tool: 'Bash',
          summary: 'run the tests',
          outcome: 'approved',
          decidedBy: 'scout',
          preference: 'Let tests run',
          at: '2026-10-28T10:00:00Z',
        },
      ],
      counts: { total: 9, scout: 2, refused: 1 },
      next: 7,
    });
    expect(calls).toEqual([['list_approvals', { filter: 'scout', before: 12 }]]);
  });

  it('asks for all rows with no cursor by default', async () => {
    const { invoke, calls } = setup(() =>
      text({ approvals: [], counts: { total: 0, scout: 0, refused: 0 }, next: null }),
    );
    await invoke(IPC.listApprovals, 'all');
    expect(calls).toEqual([['list_approvals', { filter: 'all' }]]);
  });

  it('rejects a bad payload', async () => {
    const { invoke } = setup(() => text({ approvals: 'nope' }));
    await expect(invoke(IPC.listApprovals, 'all')).rejects.toThrow('brain sent bad approvals');
    const other = setup(() => text({ preferences: 'nope' }));
    await expect(other.invoke(IPC.listPreferences)).rejects.toThrow('brain sent bad preferences');
  });

  it('refuses a filter it does not know, without asking the brain', async () => {
    const { invoke, calls } = setup(() => []);
    await expect(invoke(IPC.listApprovals, 'everything')).rejects.toThrow('bad filter');
    expect(calls).toEqual([]);
  });

  it('lists preferences in camelCase', async () => {
    const { invoke, calls } = setup(() => text({ preferences: [BRAIN_PREF] }));
    expect(await invoke(IPC.listPreferences)).toEqual([
      {
        id: 3,
        sentence: 'Let tests run',
        builtin: false,
        createdAt: '2026-10-27T09:00:00Z',
        useCount: 4,
        lastUsed: '2026-10-28T10:00:00Z',
      },
    ]);
    expect(calls).toEqual([['list_preferences', {}]]);
  });

  it('removes a preference through the brain', async () => {
    const { invoke, calls } = setup(() => text({ id: 3, removed: true }));
    await invoke(IPC.removePreference, 3);
    expect(calls).toEqual([['remove_preference', { id: 3 }]]);
  });

  it('rejects a non-numeric preference id before calling the brain', async () => {
    const { invoke, calls } = setup(() => []);
    await expect(invoke(IPC.removePreference, '3')).rejects.toThrow('bad preference id');
    await expect(invoke(IPC.editPreference, 1.5, 'x')).rejects.toThrow('bad preference id');
    expect(calls).toEqual([]);
  });

  it('edit sends id and sentence', async () => {
    const { invoke, calls } = setup(() => text({ id: 3, sentence: 'Only tests' }));
    await invoke(IPC.editPreference, 3, 'Only tests');
    expect(calls).toEqual([['edit_preference', { id: 3, sentence: 'Only tests' }]]);
  });

  it('refuses an edit whose sentence is not a string', async () => {
    const { invoke, calls } = setup(() => []);
    await expect(invoke(IPC.editPreference, 3, 9)).rejects.toThrow('bad sentence');
    expect(calls).toEqual([]);
  });

  it('lets an offline brain reject, so the page can say it could not read', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.listApprovals, 'all')).rejects.toBeInstanceOf(BrainOffline);
  });

  it('handles its four channels and nothing else', () => {
    expect(setup(() => []).channels()).toEqual(
      [IPC.listApprovals, IPC.listPreferences, IPC.removePreference, IPC.editPreference].sort(),
    );
  });
});
