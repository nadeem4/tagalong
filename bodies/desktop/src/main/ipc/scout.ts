/**
 * IPC for Scout as a pet. The brain has no pet records yet, so Scout is the one fixed local
 * pet and editing it says so plainly. Contains registerScoutIpc and localScout.
 */

import { SCOUT } from '@tagalong/core';
import type { Pet } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

const NOT_YET = 'Scout cannot do that yet on the new brain.';

/** The one pet there is: core's default Scout, copied so no caller can change the seed. */
export function localScout(): Pet {
  return { ...SCOUT };
}

export function registerScoutIpc(handle: IpcHandle): void {
  handle(IPC.listPets, (): Pet[] => [localScout()]);
  handle(IPC.savePet, () => Promise.reject(new Error(NOT_YET)));
  handle(IPC.switchScout, () => Promise.reject(new Error(NOT_YET)));
}
