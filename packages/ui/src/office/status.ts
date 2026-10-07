/** What a pet is doing, as far as the office can tell today. Meetings come later. */
export type OfficeStatus = 'working' | 'desk';

/** The turns in flight: turn id to the pet answering it. */
export type OfficeActivity = Readonly<Record<string, string>>;

export const NO_ACTIVITY: OfficeActivity = {};

/** The slice of a turn event the office reads. */
export interface ActivityEvent {
  type: string;
  turnId?: string | undefined;
  petId?: string | undefined;
}

/**
 * The turns in flight after one event: added on `turn.started`, dropped when the turn
 * completes or errors. Returns the same object when nothing changed, so React skips the
 * render.
 */
export function nextActivity(activity: OfficeActivity, event: ActivityEvent): OfficeActivity {
  const { turnId } = event;
  if (turnId === undefined) return activity;
  if (event.type === 'turn.started' && event.petId !== undefined) {
    return { ...activity, [turnId]: event.petId };
  }
  if (
    (event.type === 'turn.completed' || event.type === 'turn.error') &&
    Object.hasOwn(activity, turnId)
  ) {
    const rest = { ...activity };
    delete rest[turnId];
    return rest;
  }
  return activity;
}

/** Working while any of the pet's turns is in flight, otherwise at its desk. */
export function statusOf(activity: OfficeActivity, petId: string): OfficeStatus {
  return Object.values(activity).includes(petId) ? 'working' : 'desk';
}
