/**
 * IPC for Scout as a pet. The brain has no pet records, so Scout is the one fixed local pet.
 * Contains registerScoutIpc and localScout.
 */

import { SCOUT_ID } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

/** The one pet there is; the brain, not this record, decides who answers. */
const SCOUT: Pet = { id: SCOUT_ID, name: 'Scout', avatar: '🦊' };

/** A copy of Scout, so no caller can change the one record. */
export function localScout(): Pet {
  return { ...SCOUT };
}

export function registerScoutIpc(handle: IpcHandle): void {
  handle(IPC.listPets, (): Pet[] => [localScout()]);
}
