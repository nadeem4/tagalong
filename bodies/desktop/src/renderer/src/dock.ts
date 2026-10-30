/**
 * What the companion on the dock is doing, kept apart from its rendering so it is tested
 * in plain Node. Seeing wins while a capture is fresh; then reading, while a screen tool is
 * in flight; then thinking, while the companion answers the person; then working, while one
 * of Scout's own background turns (a job, a wake) runs; then Seeing again while something is
 * held over the pet to drop on it; then dozing, while the person is away.
 * Contains nextDock and dockMood (the mood reducer) and startDrag/moveDrag (when a press
 * becomes a drag).
 */
import type { DockMood } from '@tagalong/ui';

export interface DockState {
  seeing: boolean;
  /** The person's own turns: Scout thinking. */
  turns: ReadonlySet<string>;
  /** Background turns, a job's or a wake's: Scout working on its own. */
  jobs: ReadonlySet<string>;
  /** Turns with a screen tool in flight. */
  reading: ReadonlySet<string>;
  /** No input for a while, or the screen is locked. */
  away: boolean;
  /** A file, a link or text is held over the pet, not yet dropped. */
  dropHover: boolean;
}

export const IDLE_DOCK: DockState = {
  seeing: false,
  turns: new Set(),
  jobs: new Set(),
  reading: new Set(),
  away: false,
  dropHover: false,
};

/**
 * The slice of an event the dock reads: turn events, plus its own (seeing, seen, dropHover,
 * dropLeave) and main's presence.away and presence.back.
 */
export interface DockEvent {
  type: string;
  turnId?: string | undefined;
  petId?: string | undefined;
  /** On turn.started: a turn nobody is watching (a job's or a wake's). */
  background?: true | undefined;
  /** On turn.toolRequest and turn.toolResult: the tool's name. */
  tool?: string | undefined;
}

/**
 * The tools that read the screen: the ones the desktop body declares in
 * main/brain/body-tools.ts (dock.test.ts keeps the two in step). Spelled out here, as the
 * renderer never bundles main.
 */
const READING_TOOLS: ReadonlySet<string> = new Set([
  'list_windows',
  'read_window_text',
  'look_at_window',
]);

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
    // Something held over the pet; the drop itself ends it with dropLeave too.
    case 'dropHover':
      return state.dropHover ? state : { ...state, dropHover: true };
    case 'dropLeave':
      return state.dropHover ? { ...state, dropHover: false } : state;
    case 'presence.away':
      return state.away ? state : { ...state, away: true };
    case 'presence.back':
      return state.away ? { ...state, away: false } : state;
    case 'turn.started':
      if (event.turnId === undefined) return state;
      return event.background === true
        ? { ...state, jobs: new Set([...state.jobs, event.turnId]) }
        : { ...state, turns: new Set([...state.turns, event.turnId]) };
    case 'turn.toolRequest':
      return event.turnId === undefined ||
        !READING_TOOLS.has(event.tool ?? '') ||
        state.reading.has(event.turnId)
        ? state
        : { ...state, reading: new Set([...state.reading, event.turnId]) };
    case 'turn.toolResult':
      return event.turnId === undefined ||
        !READING_TOOLS.has(event.tool ?? '') ||
        !state.reading.has(event.turnId)
        ? state
        : { ...state, reading: without(state.reading, event.turnId) };
    // An aborted turn sends no tool result: its end clears reading too.
    case 'turn.completed':
    case 'turn.error': {
      const id = event.turnId;
      if (id === undefined || ![state.turns, state.jobs, state.reading].some((s) => s.has(id))) {
        return state;
      }
      return {
        ...state,
        turns: without(state.turns, id),
        jobs: without(state.jobs, id),
        reading: without(state.reading, id),
      };
    }
    default:
      return state;
  }
}

export function dockMood(state: DockState): DockMood {
  if (state.seeing) return 'listening';
  if (state.reading.size > 0) return 'reading';
  if (state.turns.size > 0) return 'thinking';
  if (state.jobs.size > 0) return 'working';
  if (state.dropHover) return 'listening';
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
