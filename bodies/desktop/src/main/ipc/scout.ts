/**
 * IPC for Scout as a pet. The brain has no pet records, so Scout is the one fixed local pet.
 * Contains registerScoutIpc and localScout.
 */

import { SCOUT } from '@tagalong/core';
import type { Pet } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

/** The one pet there is: core's default Scout, copied so no caller can change the seed. */
export function localScout(): Pet {
  return { ...SCOUT };
}

export function registerScoutIpc(handle: IpcHandle): void {
  handle(IPC.listPets, (): Pet[] => [localScout()]);
}
