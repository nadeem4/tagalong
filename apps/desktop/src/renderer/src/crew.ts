/**
 * Picks the pet the avatar window shows: the default pet first, any pet in `settings.hiddenPets`
 * left out. Used by avatar.tsx.
 */
import type { Pet } from '@tagalong/protocol';

/**
 * The pets that may be shown, the default one first and the hidden ones left out. The avatar
 * shows the first.
 */
export function visibleCrew(
  pets: readonly Pet[],
  hiddenPets: readonly string[],
  defaultPetId: string,
): Pet[] {
  const shown = pets.filter((pet) => !hiddenPets.includes(pet.id));
  const first = shown.find((pet) => pet.id === defaultPetId);
  return first === undefined ? shown : [first, ...shown.filter((pet) => pet !== first)];
}
