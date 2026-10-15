import type { DockMood } from '@tagalong/ui';

/**
 * What the companion on the dock is doing, kept apart from its rendering so it is tested
 * in plain Node. Seeing wins while a capture is fresh; then working, while the companion
 * answers or an expert has a task; then a wince or a cheer, for a few seconds; then done,
 * until the person clicks to look; then dozing, while the person is away.
 */
export interface DockState {
  seeing: boolean;
  turns: ReadonlySet<string>;
  handoffs: ReadonlySet<string>;
  done: boolean;
  /** No input for a while, or the screen is locked. */
  away: boolean;
  /** A short reaction from `pet.mood`, until `reacted` clears it. */
  reaction: 'wince' | 'cheer' | null;
}

export const IDLE_DOCK: DockState = {
  seeing: false,
  turns: new Set(),
  handoffs: new Set(),
  done: false,
  away: false,
  reaction: null,
};

/** How long a wince or a cheer stays on the face. */
export const REACTION_MS = 4_000;

/**
 * The slice of an event the dock reads: engine notifications, plus its own (seeing, seen,
 * looked, reacted) and main's presence.away and presence.back.
 */
export interface DockEvent {
  type: string;
  turnId?: string | undefined;
  petId?: string | undefined;
  handoffId?: string | undefined;
  mood?: string | undefined;
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
    case 'presence.away':
      return state.away ? state : { ...state, away: true };
    case 'presence.back':
      return state.away ? { ...state, away: false } : state;
    case 'pet.mood':
      return event.mood === 'wince' || event.mood === 'cheer'
        ? { ...state, reaction: event.mood }
        : state;
    case 'reacted':
      return state.reaction === null ? state : { ...state, reaction: null };
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
  if (state.reaction !== null) return state.reaction;
  if (state.done) return 'done';
  return state.away ? 'dozing' : 'idle';
}

/** How far the pointer moves before a press on the pet becomes a drag instead of a click. */
export const DRAG_THRESHOLD = 4;

export interface Point {
  x: number;
  y: number;
}

export interface DragState {
  start: Point;
  last: Point;
  dragging: boolean;
}

export function startDrag(at: Point): DragState {
  return { start: at, last: at, dragging: false };
}

/**
 * One pointer move during a press on the pet. Below the threshold it is still a click and
 * nothing moves; past it, each move returns the step to move the pet by, in screen pixels.
 */
export function moveDrag(
  state: DragState,
  at: Point,
): { state: DragState; step: { dx: number; dy: number } | null } {
  const dragging =
    state.dragging || Math.hypot(at.x - state.start.x, at.y - state.start.y) > DRAG_THRESHOLD;
  if (!dragging) return { state, step: null };
  return {
    state: { start: state.start, last: at, dragging: true },
    step: { dx: at.x - state.last.x, dy: at.y - state.last.y },
  };
}
