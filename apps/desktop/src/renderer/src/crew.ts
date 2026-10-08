import type { Pet } from '@tagalong/protocol';
import type { CaptureNotice } from '../../shared/ipc';

/**
 * The one pet on the desktop: the default pet, or the first one when the default is gone.
 *
 * `hiddenPets` is not read here. It chose which pets the old multi-pet strip showed; with a
 * single companion there is nothing left for it to hide.
 */
export function companionFor(pets: readonly Pet[], defaultPetId: string): Pet | undefined {
  return pets.find((pet) => pet.id === defaultPetId) ?? pets[0];
}

/** The slice of a turn or crew event the companion reads. */
export interface ActivityEvent {
  type: string;
  turnId?: string | undefined;
  petId?: string | undefined;
  kind?: string | undefined;
  fromPetId?: string | undefined;
  toPetId?: string | undefined;
}

/** Turns in flight, each with the pet answering it and the pets it consulted. */
export interface Activity {
  readonly turns: Readonly<Record<string, { petId: string; helpers: readonly string[] }>>;
}

export const NO_ACTIVITY: Activity = { turns: {} };

/**
 * The activity after one event: a turn counts from its `turn.started` until it completes or
 * fails, and a consult adds the consulted pet to the asking turn until that turn ends.
 * Returns the same object when nothing changed, so React skips the render.
 */
export function nextActivity(activity: Activity, event: ActivityEvent): Activity {
  const { turnId } = event;
  if (turnId === undefined) return activity;
  if (event.type === 'turn.started' && event.petId !== undefined) {
    const helpers = activity.turns[turnId]?.helpers ?? [];
    return { turns: { ...activity.turns, [turnId]: { petId: event.petId, helpers } } };
  }
  if (event.type === 'pet.message' && event.kind === 'consult' && event.toPetId !== undefined) {
    const turn = activity.turns[turnId] ?? { petId: event.fromPetId ?? '', helpers: [] };
    if (turn.helpers.includes(event.toPetId)) return activity;
    const helpers = [...turn.helpers, event.toPetId];
    return { turns: { ...activity.turns, [turnId]: { ...turn, helpers } } };
  }
  if (event.type === 'turn.completed' || event.type === 'turn.error') {
    if (!Object.hasOwn(activity.turns, turnId)) return activity;
    const turns = { ...activity.turns };
    delete turns[turnId];
    return { turns };
  }
  return activity;
}

/** Any turn in flight: the crew is at work, and the companion shows it. */
export function isWorking(activity: Activity): boolean {
  return Object.keys(activity.turns).length > 0;
}

/**
 * The pets helping right now: everyone consulted on a turn in flight, and any other pet
 * answering a turn of its own, each once and never the companion itself.
 */
export function helpersOf(activity: Activity, companionId: string): string[] {
  const ids = new Set<string>();
  for (const turn of Object.values(activity.turns)) {
    ids.add(turn.petId);
    for (const helper of turn.helpers) ids.add(helper);
  }
  ids.delete(companionId);
  ids.delete('');
  return [...ids];
}

/** Phase 3B. Which pets are watching, and which have a fired watch nobody has looked at. */
export interface WatchCues {
  watching: Readonly<Record<string, readonly string[]>>;
  alerts: readonly string[];
}

export const NO_WATCH_CUES: WatchCues = { watching: {}, alerts: [] };

/** The slice of a watch event the companion reads. */
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

/** One pet stands for the crew on the desktop, so any pet's watch shows on it. */
export function anyWatching(cues: WatchCues): boolean {
  return Object.values(cues.watching).some((ids) => ids.length > 0);
}

/** Clicking the companion is looking: every alert goes. */
export function clearAlerts(cues: WatchCues): WatchCues {
  return cues.alerts.length === 0 ? cues : { ...cues, alerts: [] };
}

/** A capture the badge announces: a picture that was really taken. */
export function isLook(notice: CaptureNotice): boolean {
  return notice.screenshot && notice.blocked === undefined && notice.paused !== true;
}
