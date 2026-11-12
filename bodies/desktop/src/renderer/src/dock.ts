/**
 * What the companion on the dock is doing, kept apart from its rendering so it is tested
 * in plain Node. A short reaction (job done, failure, stopped, Scout speaking up, a click)
 * wins while it lasts; then Seeing while a capture is fresh; then reading, while a screen tool
 * is in flight; then speaking, while the voice plays; then thinking, while the companion
 * answers the person; then working, while a job runs (a background turn or a running row in
 * the jobs list); then Seeing again while something is held over the pet to drop on it; then
 * dozing, while the person is away.
 * Contains nextDock and dockMood (the mood reducer) and startDrag/moveDrag (when a press
 * becomes a drag).
 */
import type { DockMood } from '@tagalong/ui';

/** The moods that play briefly, then give way to whatever the dock is doing. */
type FlashMood = Extract<DockMood, 'celebrating' | 'error' | 'sad' | 'surprised' | 'happy'>;

interface DockState {
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
  /** Scout's voice is playing. */
  speaking: boolean;
  /** Each listed job's state, to tell a job that just finished from one listed that way. */
  jobStates: ReadonlyMap<string, string> | null;
  /** Whether a job in the list is running. */
  jobRunning: boolean;
  /** The short reaction now playing; its id lets the host end exactly this one. */
  flash: { mood: FlashMood; id: number } | null;
}

export const IDLE_DOCK: DockState = {
  seeing: false,
  turns: new Set(),
  jobs: new Set(),
  reading: new Set(),
  away: false,
  dropHover: false,
  speaking: false,
  jobStates: null,
  jobRunning: false,
  flash: null,
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
  /** On turn.completed: why it ended; `aborted` is a turn the person stopped. */
  stopReason?: string | undefined;
  /** On `jobs`: the brain's job list, as Home reads it. */
  jobs?: readonly { id: string; state: string }[] | undefined;
  /** On `flashEnd`: the flash that has run its time. */
  id?: number | undefined;
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

/** A job that was running and now is not: how it ended decides the reaction. */
const JOB_ENDED: Readonly<Record<string, FlashMood>> = {
  done: 'celebrating',
  error: 'error',
  stopped: 'sad',
};

function flashed(state: DockState, mood: FlashMood): DockState {
  return { ...state, flash: { mood, id: (state.flash?.id ?? 0) + 1 } };
}

function jobsListed(state: DockState, jobs: readonly { id: string; state: string }[]): DockState {
  const next = new Map(jobs.map((job) => [job.id, job.state]));
  const jobRunning = jobs.some((job) => job.state === 'running');
  let mood: FlashMood | undefined;
  // The first list is a baseline: jobs that finished long ago are not news.
  if (state.jobStates !== null) {
    for (const [id, now] of next) {
      if (state.jobStates.get(id) === 'running') mood = JOB_ENDED[now] ?? mood;
    }
  }
  const moved: DockState = { ...state, jobStates: next, jobRunning };
  return mood === undefined ? moved : flashed(moved, mood);
}

export function nextDock(state: DockState, event: DockEvent): DockState {
  switch (event.type) {
    case 'speech.started':
      return state.speaking ? state : { ...state, speaking: true };
    case 'speech.ended':
      return state.speaking ? { ...state, speaking: false } : state;
    case 'jobs':
      return jobsListed(state, event.jobs ?? []);
    case 'poke':
      return flashed(state, 'happy');
    // Scout spoke up on its own: it surprises the person as much as it is surprised itself.
    case 'pet.remark':
      return flashed(state, 'surprised');
    case 'flashEnd':
      return state.flash !== null && state.flash.id === event.id
        ? { ...state, flash: null }
        : state;
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
      const ended: DockState = {
        ...state,
        turns: without(state.turns, id),
        jobs: without(state.jobs, id),
        reading: without(state.reading, id),
      };
      if (event.type === 'turn.error') return flashed(ended, 'error');
      return event.stopReason === 'aborted' ? flashed(ended, 'sad') : ended;
    }
    default:
      return state;
  }
}

/** `hearing`: speech is being heard on the mic (Always listening), which the reducer never sees. */
export function dockMood(state: DockState, hearing = false): DockMood {
  if (state.flash !== null) return state.flash.mood;
  if (state.seeing || hearing) return 'listening';
  if (state.reading.size > 0) return 'reading';
  if (state.speaking) return 'speaking';
  if (state.turns.size > 0) return 'thinking';
  if (state.jobs.size > 0 || state.jobRunning) return 'working';
  if (state.dropHover) return 'listening';
  return state.away ? 'dozing' : 'idle';
}

/** How far the pointer moves before a press on the pet becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;

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
