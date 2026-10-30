/**
 * IPC for Scout as a pet. The brain has no pet records, so Scout is the one fixed local pet.
 * Contains registerScoutIpc and localScout.
 */

import type { Pet } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

/** Scout's id: the one pet there is. */
export const SCOUT_ID = 'scout';

/** The one pet there is; the brain, not this record, decides who answers. */
const SCOUT: Pet = { id: SCOUT_ID, name: 'Scout', avatar: '🦊' };

/** A copy of Scout, so no caller can change the one record. */
export function localScout(): Pet {
  return { ...SCOUT };
}

export function registerScoutIpc(handle: IpcHandle): void {
  handle(IPC.listPets, (): Pet[] => [localScout()]);
}
