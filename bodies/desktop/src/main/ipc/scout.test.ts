/** Tests for the pet IPC on the brain: Scout is a fixed local pet. */

import { describe, expect, it } from 'vitest';

import type { TurnEvent } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { SCOUT_ID, localScout, registerScoutIpc } from './scout';

const OPEN: TurnEvent = {
  type: 'connector.confirm',
  approvalId: 'x',
  turnId: '',
  petId: 'scout',
  app: 'Claude Code',
  tool: 'hand_off',
  summary: 'Write ten poems',
  options: ['Manual', 'cancel'],
};

function setup() {
  const ipc = fakeIpc();
  registerScoutIpc(ipc.handle, () => [OPEN]);
  return ipc;
}

describe('registerScoutIpc', () => {
  it('lists the one local Scout', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.listPets)).toEqual([localScout()]);
    expect(localScout()).toMatchObject({ id: SCOUT_ID, name: 'Scout', avatar: '🦊' });
  });

  it('hands the renderer the confirm cards still open', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.openConfirms)).toEqual([OPEN]);
  });

  it('hands out a copy, so a caller cannot change the one Scout', () => {
    const first = localScout();
    first.name = 'Changed';
    expect(localScout().name).toBe('Scout');
  });
});
