/** Tests for the connected-app IPC. */

import { ErrorCode } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { BrainOffline, RpcError } from '../brain/brain-client';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerConnectionIpc } from './connections';

const CONNECTION = { id: 'files', name: 'Files' };

function setup() {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'connections.list': { connections: [CONNECTION] },
    'connections.add': { connection: CONNECTION },
    'connections.setEnabled': { connection: CONNECTION },
    'connections.signIn': { connection: CONNECTION },
    'connections.remove': { removed: true },
  });
  const answers: [string, string][] = [];
  registerConnectionIpc(ipc.handle, {
    engine: () => engine.client,
    answer: (ask, decision) => {
      answers.push([ask, decision]);
      return Promise.resolve();
    },
  });
  return { ...ipc, calls: engine.calls, answers };
}

describe('registerConnectionIpc', () => {
  it("answers Scout's ask on the brain, not the old engine", async () => {
    const { invoke, calls, answers } = setup();
    await invoke(IPC.approveTool, 'a1', 'once');
    await invoke(IPC.approveTool, 'a2', 'always');
    await invoke(IPC.approveTool, 'a3', 'deny');
    expect(answers).toEqual([
      ['a1', 'once'],
      ['a2', 'always'],
      ['a3', 'deny'],
    ]);
    expect(calls).toEqual([]);
  });

  const failing = (error: Error) => {
    const ipc = fakeIpc();
    registerConnectionIpc(ipc.handle, {
      engine: () => fakeEngine({}).client,
      answer: () => Promise.reject(error),
    });
    return ipc;
  };

  it('an ask the brain no longer has (not_found) does not throw into the card', async () => {
    const ipc = failing(new RpcError(ErrorCode.not_found, 'no open ask'));
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).resolves.toBeUndefined();
  });

  it('an offline brain rejects, so the card stays up for another click', async () => {
    const ipc = failing(new BrainOffline());
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).rejects.toThrow('brain offline');
  });

  it('any other refusal rejects too', async () => {
    const ipc = failing(new RpcError(ErrorCode.tool_failed, 'boom'));
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).rejects.toThrow('boom');
  });

  it('fills the defaults of a new local connection before it goes out', async () => {
    const { invoke, calls } = setup();
    const added = await invoke(IPC.addConnection, {
      name: 'Files',
      transport: { type: 'stdio', command: 'npx' },
      auth: 'none',
    });
    expect(added).toEqual(CONNECTION);
    expect(calls).toEqual([
      [
        'connections.add',
        {
          name: 'Files',
          transport: { type: 'stdio', command: 'npx', args: [], env: {} },
          auth: 'none',
        },
      ],
    ]);
  });

  it('refuses a connection that does not parse, without calling the engine', async () => {
    const { invoke, calls } = setup();
    await expect(invoke(IPC.addConnection, { name: '' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('lists, enables, signs in and removes connections', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listConnections)).toEqual({ connections: [CONNECTION] });
    expect(await invoke(IPC.setConnectionEnabled, 'files', false)).toEqual(CONNECTION);
    expect(await invoke(IPC.signInConnection, 'files')).toEqual(CONNECTION);
    expect(await invoke(IPC.removeConnection, 'files')).toBe(true);
    expect(calls).toEqual([
      ['connections.list', {}],
      ['connections.setEnabled', { id: 'files', enabled: false }],
      ['connections.signIn', { id: 'files' }],
      ['connections.remove', { id: 'files' }],
    ]);
  });
});
