import type { Pet } from '@tagalong/protocol';

/** The pets that may sit on the dock: the default one first, the hidden ones left out. */
export function visibleCrew(
  pets: readonly Pet[],
  hiddenPets: readonly string[],
  defaultPetId: string,
): Pet[] {
  const shown = pets.filter((pet) => !hiddenPets.includes(pet.id));
  const first = shown.find((pet) => pet.id === defaultPetId);
  return first === undefined ? shown : [first, ...shown.filter((pet) => pet !== first)];
}
