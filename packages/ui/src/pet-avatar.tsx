import { useEffect, useState } from 'react';
import type { Pet } from '@tagalong/protocol';

/** Long enough to be noticed, short enough not to be ignored as decoration. */
const CAPTURE_BADGE_MS = 1000;

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
  /**
   * How many captures have happened. A counter rather than a timestamp: two captures
   * in the same millisecond must still each show the badge, because capture is never
   * allowed to happen silently.
   */
  captureCount?: number;
  /**
   * Whether the user has turned sight off.
   *
   * A state rather than an event, unlike `captureCount`: the capture badge says "it just
   * looked" and fades, this says "it cannot look" and stays until the user ends it.
   */
  sightPaused?: boolean;
}

export function PetAvatar({
  pet,
  state = 'idle',
  captureCount = 0,
  sightPaused = false,
}: PetAvatarProps) {
  // Which capture the badge has already been shown for. Derived visibility rather than
  // a flag set from an effect, so a re-render can never lose or duplicate the badge.
  const [faded, setFaded] = useState(0);
  // Nothing was read while paused, so nothing may claim it was: a capture badge here
  // would be the app announcing a look at the moment it refused one.
  const captured = !sightPaused && captureCount > faded;

  useEffect(() => {
    if (!captured) {
      return;
    }
    const timer = setTimeout(() => setFaded(captureCount), CAPTURE_BADGE_MS);
    return () => clearTimeout(timer);
  }, [captured, captureCount]);

  return (
    <span
      role="img"
      aria-label={`${pet.name} is ${state}${sightPaused ? ', sight paused' : ''}`}
      data-state={state}
      className={`relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-2xl ring-4 ${RING_BY_STATE[state]}`}
    >
      {sightPaused && (
        <span
          data-testid="paused-eye"
          title="Sight is paused — Tagalong cannot see your screen"
          className="absolute -right-0.5 -top-0.5 rounded-full bg-slate-400 px-1 text-[10px] leading-4 text-slate-900"
        >
          👁
        </span>
      )}
      {captured && (
        <span
          data-testid="capture-badge"
          title="Read the screen just now"
          className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 px-1 text-[10px] leading-4 text-amber-950"
        >
          👁
        </span>
      )}
      {isImageAvatar(pet.avatar) ? (
        <img src={pet.avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        pet.avatar
      )}
    </span>
  );
}
