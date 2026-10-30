/** Tests for the pet IPC on the brain: Scout is a fixed local pet. */

import { describe, expect, it } from 'vitest';
import { SCOUT } from '@tagalong/core';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { localScout, registerScoutIpc } from './scout';

function setup() {
  const ipc = fakeIpc();
  registerScoutIpc(ipc.handle);
  return ipc;
}

describe('registerScoutIpc', () => {
  it('lists the one local Scout, built from the default seed', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.listPets)).toEqual([localScout()]);
    expect(localScout()).toEqual(SCOUT);
  });

  it('hands out a copy, so a caller cannot change the seed', () => {
    expect(localScout()).not.toBe(SCOUT);
  });
});
