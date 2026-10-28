/** Tests for the brain link IPC: the address the desktop dials and whether it is connected. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerBrainLinkIpc } from './brain-link';
import { fakeIpc } from './fake-ipc';

describe('registerBrainLinkIpc', () => {
  it('answers with the ws address and the current status', async () => {
    const ipc = fakeIpc();
    let link: 'online' | 'offline' = 'online';
    registerBrainLinkIpc(ipc.handle, {
      brain: {
        addr: '127.0.0.1:47321',
        get link() {
          return link;
        },
      },
    });
    expect(await ipc.invoke(IPC.brainLink)).toEqual({
      addr: 'ws://127.0.0.1:47321',
      status: 'online',
    });
    link = 'offline';
    expect(await ipc.invoke(IPC.brainLink)).toEqual({
      addr: 'ws://127.0.0.1:47321',
      status: 'offline',
    });
  });
});
