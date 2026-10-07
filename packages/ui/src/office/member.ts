import type { Pet } from '@tagalong/protocol';
import type { Character } from './sprites/characters';
import type { OfficeStatus } from './status';

/** One pet as the office draws it. */
export interface OfficeMember {
  pet: Pet;
  character: Character;
  status: OfficeStatus;
}
