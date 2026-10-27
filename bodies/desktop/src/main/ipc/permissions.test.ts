/** Tests for the Permissions IPC, which lists and sets each tool's mode through the brain. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { BrainOffline, RpcError } from '../brain/brain-client';
import { fakeIpc } from './fake-ipc';
import { registerPermissionsIpc } from './permissions';

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
  registerPermissionsIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

const TOOL = {
  name: 'desktop__move_window',
  description: 'Move a window',
  effect: 'change',
  mode: 'ask',
  locked: false,
  online: true,
};

describe('registerPermissionsIpc', () => {
  it('lists the brain permission rows as Home shows them', async () => {
    const { invoke, calls } = setup(() =>
      text({ tools: [TOOL, { ...TOOL, name: 'forget', locked: true }] }),
    );
    expect(await invoke(IPC.listPermissions)).toEqual([
      TOOL,
      { ...TOOL, name: 'forget', locked: true },
    ]);
    expect(calls).toEqual([['list_permissions', {}]]);
  });

  it('sets a mode through the brain', async () => {
    const { invoke, calls } = setup(() => text({ tool: TOOL.name, mode: 'auto' }));
    await invoke(IPC.setPermission, TOOL.name, 'auto');
    expect(calls).toEqual([['set_permission', { tool: TOOL.name, mode: 'auto' }]]);
  });

  it('rejects when the brain refuses the change', async () => {
    const { invoke } = setup(() => Promise.reject(new RpcError(-32602, 'always asks')));
    await expect(invoke(IPC.setPermission, 'forget', 'auto')).rejects.toBeInstanceOf(RpcError);
  });

  it('refuses a mode that is neither ask nor auto, without asking the brain', async () => {
    const { invoke, calls } = setup(() => []);
    await expect(invoke(IPC.setPermission, TOOL.name, 'never')).rejects.toThrow('bad mode');
    expect(calls).toEqual([]);
  });

  it('lets an offline brain reject, so the panel can say it could not read', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.listPermissions)).rejects.toBeInstanceOf(BrainOffline);
  });

  it('rejects a list the brain answered with something that is not permissions', async () => {
    const { invoke } = setup(() => text({ nope: true }));
    await expect(invoke(IPC.listPermissions)).rejects.toThrow('brain sent bad permissions');
  });

  it('handles its two channels and nothing else', () => {
    expect(setup(() => []).channels()).toEqual([IPC.listPermissions, IPC.setPermission].sort());
  });
});
