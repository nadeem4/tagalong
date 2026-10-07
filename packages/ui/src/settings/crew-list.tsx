import type { Pet, Role } from '@tagalong/protocol';
import { PixelSprite } from '../office/pixel-sprite';
import { characterFor } from '../office/sprites/characters';
import { officeTokens as t } from '../office/tokens';
import { roleInk } from './roles-view';

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
        const roleName = roles.find((role) => role.id === pet.roleId)?.name ?? pet.roleId;
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
                <span className="tg-px tg-job" style={{ color: roleInk(roleName) }}>
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
