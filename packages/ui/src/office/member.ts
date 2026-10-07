import type { Pet } from '@tagalong/protocol';
import type { Job } from './job';
import type { Character } from './sprites/characters';
import type { OfficeStatus } from './status';

/** One pet as the office draws it. */
export interface OfficeMember {
  pet: Pet;
  character: Character;
  job: Job;
  status: OfficeStatus;
}
