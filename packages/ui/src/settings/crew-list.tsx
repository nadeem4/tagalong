import type { Pet, Role } from '@tagalong/protocol';
import { PixelSprite } from '../office/pixel-sprite';
import { characterFor } from '../office/sprites/characters';
import { officeTokens as t } from '../office/tokens';
import { jobFor } from '../office/job';

export interface CrewListProps {
  pets: readonly Pet[];
  roles: readonly Role[];
  selectedId: string | null;
  onSelect: (petId: string) => void;
}

/** The crew in Settings: each pet's sprite, name and role. The selected row is ringed gold. */
export function CrewList({ pets, roles, selectedId, onSelect }: CrewListProps) {
  return (
    <ul>
      {pets.map((pet) => {
        // A role the library lacks works as a generalist, so it reads as one (as in the office);
        // nothing is shown until the library has loaded.
        const role =
          roles.find((r) => r.id === pet.roleId) ?? roles.find((r) => r.id === 'generalist');
        const roleName = roles.length === 0 ? '' : (role?.name ?? 'Generalist');
        return (
          <li key={pet.id}>
            <button
              type="button"
              className="tg-row"
              aria-pressed={pet.id === selectedId}
              onClick={() => onSelect(pet.id)}
            >
              <span className="tg-tile">
                <PixelSprite sprite={characterFor(pet).sprite} scale={t.spriteScale.tile} />
              </span>
              <span>
                <span className="tg-px tg-name">{pet.name}</span>
                <span className="tg-px tg-job" style={{ color: jobFor(pet.roleId, roles).ink }}>
                  {roleName}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
