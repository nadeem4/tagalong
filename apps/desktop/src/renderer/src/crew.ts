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

/** Phase 3B. Which pets are watching, and which have a fired watch nobody has looked at. */
export interface WatchCues {
  watching: Readonly<Record<string, readonly string[]>>;
  alerts: readonly string[];
}

export const NO_WATCH_CUES: WatchCues = { watching: {}, alerts: [] };

/** The slice of a watch event the strip reads. */
export interface WatchCueEvent {
  type: string;
  watchId?: string;
  petId?: string;
  state?: string;
}

/** The cues after one event. Returns the same object for anything that is not a watch's. */
export function nextWatchCues(cues: WatchCues, event: WatchCueEvent): WatchCues {
  const { watchId, petId } = event;
  if (watchId === undefined || petId === undefined) return cues;
  if (event.type === 'watch.fired') {
    return cues.alerts.includes(petId) ? cues : { ...cues, alerts: [...cues.alerts, petId] };
  }
  if (event.type !== 'watch.status') return cues;
  const others = (cues.watching[petId] ?? []).filter((id) => id !== watchId);
  const ids = event.state === 'watching' ? [...others, watchId] : others;
  return { ...cues, watching: { ...cues.watching, [petId]: ids } };
}

export function isWatching(cues: WatchCues, petId: string): boolean {
  return (cues.watching[petId]?.length ?? 0) > 0;
}

/** Clicking the pet is looking: its alert goes. */
export function clearAlert(cues: WatchCues, petId: string): WatchCues {
  return cues.alerts.includes(petId)
    ? { ...cues, alerts: cues.alerts.filter((id) => id !== petId) }
    : cues;
}
