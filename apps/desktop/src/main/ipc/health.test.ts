import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerHealthIpc } from './health';

describe('registerHealthIpc', () => {
  it('asks the engine whether the browser extension is connected', async () => {
    const ipc = fakeIpc();
    const { client, calls } = fakeEngine({ 'hosts.status': { extension: true } });
    registerHealthIpc(ipc.handle, { engine: () => client });
    expect(await ipc.invoke(IPC.hostsStatus)).toEqual({ extension: true });
    expect(calls).toEqual([['hosts.status', {}]]);
  });

  it('lets an engine that is down fail the call, for the card to show as unknown', async () => {
    const ipc = fakeIpc();
    registerHealthIpc(ipc.handle, {
      engine: () => {
        throw new Error('the engine is not running');
      },
    });
    await expect(ipc.invoke(IPC.hostsStatus)).rejects.toThrow('not running');
  });
});
