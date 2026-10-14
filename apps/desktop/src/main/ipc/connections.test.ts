import { describe, expect, it } from 'vitest';
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
  registerConnectionIpc(ipc.handle, { engine: () => engine.client });
  return { ...ipc, calls: engine.calls };
}

describe('registerConnectionIpc', () => {
  it("answers Scout's request to change something in an app", async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.approveTool, 'a1', 'once');
    await invoke(IPC.approveTool, 'a2', 'deny');
    expect(calls).toEqual([
      ['tool.approve', { approvalId: 'a1', decision: 'once' }],
      ['tool.approve', { approvalId: 'a2', decision: 'deny' }],
    ]);
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
