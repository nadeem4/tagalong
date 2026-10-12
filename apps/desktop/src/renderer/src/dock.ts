import type { DockMood } from '@tagalong/ui';

/**
 * What the companion on the dock is doing, kept apart from its rendering so it is tested
 * in plain Node. Seeing wins while a capture is fresh; then working, while the companion
 * answers or an expert has a task; then done, until the person clicks to look.
 */
export interface DockState {
  seeing: boolean;
  turns: ReadonlySet<string>;
  handoffs: ReadonlySet<string>;
  done: boolean;
}

export const IDLE_DOCK: DockState = {
  seeing: false,
  turns: new Set(),
  handoffs: new Set(),
  done: false,
};

/** The slice of an event the dock reads: engine notifications, plus its own three. */
export interface DockEvent {
  type: string;
  turnId?: string | undefined;
  petId?: string | undefined;
  handoffId?: string | undefined;
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

export function nextDock(state: DockState, event: DockEvent): DockState {
  switch (event.type) {
    case 'seeing':
      return { ...state, seeing: true };
    case 'seen':
      return { ...state, seeing: false };
    case 'looked':
      return { ...state, done: false };
    case 'turn.started':
      return event.turnId === undefined
        ? state
        : { ...state, turns: new Set([...state.turns, event.turnId]) };
    case 'turn.completed':
    case 'turn.error':
      return event.turnId === undefined || !state.turns.has(event.turnId)
        ? state
        : { ...state, turns: without(state.turns, event.turnId) };
    case 'handoff.progress':
      return event.handoffId === undefined || state.handoffs.has(event.handoffId)
        ? state
        : { ...state, handoffs: new Set([...state.handoffs, event.handoffId]) };
    case 'handoff.finished':
      return event.handoffId === undefined
        ? state
        : { ...state, handoffs: without(state.handoffs, event.handoffId), done: true };
    default:
      return state;
  }
}

export function dockMood(state: DockState): DockMood {
  if (state.seeing) return 'listening';
  if (state.turns.size > 0 || state.handoffs.size > 0) return 'working';
  return state.done ? 'done' : 'idle';
}
