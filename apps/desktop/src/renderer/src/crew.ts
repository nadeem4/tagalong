import type { Pet } from '@tagalong/protocol';
import type { PetState } from '@tagalong/ui';

/** The pets on the desktop strip: the default one first, the hidden ones left out. */
export function visibleCrew(
  pets: readonly Pet[],
  hiddenPets: readonly string[],
  defaultPetId: string,
): Pet[] {
  const shown = pets.filter((pet) => !hiddenPets.includes(pet.id));
  const first = shown.find((pet) => pet.id === defaultPetId);
  return first === undefined ? shown : [first, ...shown.filter((pet) => pet !== first)];
}

/** The slice of a turn event the strip reads. */
export interface StripEvent {
  type: string;
  turnId: string;
  petId?: string;
}

const turnOwners = new Map<string, string>();

/**
 * Each pet's ring state after one event: thinking from its `turn.started` until that turn
 * completes or fails. Keyed by turn so a roundtable — one pet after another — lights each
 * avatar in turn. Returns the same object when nothing changed, so React skips the render.
 */
export function nextPetStates(
  states: Readonly<Record<string, PetState>>,
  event: StripEvent,
): Record<string, PetState> {
  if (event.type === 'turn.started' && event.petId !== undefined) {
    turnOwners.set(event.turnId, event.petId);
    return { ...states, [event.petId]: 'thinking' };
  }
  if (event.type === 'turn.completed' || event.type === 'turn.error') {
    const owner = turnOwners.get(event.turnId);
    turnOwners.delete(event.turnId);
    return owner === undefined ? states : { ...states, [owner]: 'idle' };
  }
  return states;
}
