import type { Pet } from '@tagalong/protocol';

/** What the pet is doing right now, as far as the panel can tell. */
export type PetState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * The ring is the only signal visible when the panel is closed, so each state gets a
 * distinct colour rather than a shared accent.
 */
const RING_BY_STATE: Record<PetState, string> = {
  idle: 'ring-slate-300',
  listening: 'ring-sky-400',
  thinking: 'ring-amber-400',
  speaking: 'ring-emerald-400',
};

/** A Pet avatar is either an emoji or an asset the host can load as an image. */
function isImageAvatar(avatar: string): boolean {
  return /^(https?:\/\/|data:|\.{0,2}\/)/.test(avatar);
}

export interface PetAvatarProps {
  pet: Pet;
  state?: PetState;
}

export function PetAvatar({ pet, state = 'idle' }: PetAvatarProps) {
  return (
    <span
      role="img"
      aria-label={`${pet.name} is ${state}`}
      data-state={state}
      className={`inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-2xl ring-4 ${RING_BY_STATE[state]}`}
    >
      {isImageAvatar(pet.avatar) ? (
        <img src={pet.avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        pet.avatar
      )}
    </span>
  );
}
