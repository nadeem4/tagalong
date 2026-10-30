/** Tests for the pet IPC on the brain: Scout is a fixed local pet. */

import { describe, expect, it } from 'vitest';
import { SCOUT_ID } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { localScout, registerScoutIpc } from './scout';

function setup() {
  const ipc = fakeIpc();
  registerScoutIpc(ipc.handle);
  return ipc;
}

describe('registerScoutIpc', () => {
  it('lists the one local Scout', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.listPets)).toEqual([localScout()]);
    expect(localScout()).toMatchObject({ id: SCOUT_ID, name: 'Scout', avatar: '🦊' });
  });

  it('hands out a copy, so a caller cannot change the one Scout', () => {
    const first = localScout();
    first.name = 'Changed';
    expect(localScout().name).toBe('Scout');
  });
});
