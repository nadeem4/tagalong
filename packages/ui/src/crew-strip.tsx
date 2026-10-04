import type { Pet } from '@tagalong/protocol';

/** A neutral colour for a pet saved before pets had one. */
export const DEFAULT_PET_COLOR = '#64748b';

export interface CrewStripProps {
  pets: readonly Pet[];
  activePetId: string;
  onSelect: (petId: string) => void;
  /** Pets currently answering, drawn with a pulse so a roundtable shows whose turn it is. */
  speakingPetIds?: readonly string[];
}

/**
 * The crew as a row of avatars. Clicking one makes it the pet the next ask goes to; the
 * active one is ringed in its own colour.
 */
export function CrewStrip({ pets, activePetId, onSelect, speakingPetIds = [] }: CrewStripProps) {
  return (
    <div role="group" aria-label="Crew" className="flex items-center gap-1">
      {pets.map((pet) => {
        const active = pet.id === activePetId;
        const color = pet.color ?? DEFAULT_PET_COLOR;
        return (
          <button
            key={pet.id}
            type="button"
            aria-label={`Ask ${pet.name}`}
            aria-pressed={active}
            data-speaking={speakingPetIds.includes(pet.id) ? 'true' : 'false'}
            title={`${pet.name} · ${pet.model}`}
            onClick={() => onSelect(pet.id)}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm ${
              speakingPetIds.includes(pet.id) ? 'animate-pulse' : ''
            }`}
            style={{ borderColor: active ? color : 'transparent', backgroundColor: `${color}22` }}
          >
            <span aria-hidden="true">{pet.avatar}</span>
          </button>
        );
      })}
    </div>
  );
}
