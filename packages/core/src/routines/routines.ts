import { randomUUID } from 'node:crypto';
import {
  RPC_ERROR_CODES,
  describeWhen,
  type CaptureExclusions,
  type Expert,
  type HandoffFinishedParams,
  type Pet,
  type Routine,
  type RoutineAction,
  type RoutineDraftInput,
  type RoutineProposedParams,
  type RoutineResultParams,
  type RoutineView,
  type WindowEntry,
} from '@tagalong/protocol';
import { RoutineDraft } from '@tagalong/protocol';
import { isMeeting } from '../keep-an-eye/lookout';
import { findCaptureBlock } from '../perception/exclusions';
import { RpcFailure } from '../server/ws-server';
import type { WatchClock } from '../watch/watch-manager';
import { dueSlot, nextDue } from './schedule';
import type { StoredRoutine, RoutineStore } from './store';

/** How often the scheduler looks: schedules, apps appearing, results waiting to be said. */
export const ROUTINE_TICK_MS = 15_000;

/** A run this long after its slot ran late: the PC was asleep or Tagalong was closed. */
export const LATE_AFTER_MS = 5 * 60_000;

/** How much of an expert's answer or a watch's message rides into a triggered routine. */
const DETAIL_CHARS = 600;

/** The quiet line's length. */
const LINE_CHARS = 140;

/** One Scout turn a routine asks for. */
export interface RoutineAsk {
  pet: Pet;
  text: string;
  routineId: string;
  /** The expert the saved card allowed: read-only, no project, no card. */
  preApprovedExpertId?: string | undefined;
  /** The routine's saved instruction, which the pre-approved brief is built from. */
  instruction: string;
  /** Called by the turn when it handed the work to that expert. */
  handedOff: (handoffId: string) => void;
}

export interface RoutineTurn {
  conversationId: string;
  done: Promise<{ text: string; error?: { message: string } | undefined }>;
}

export type RoutineEvent =
  | { method: 'routine.proposed'; params: RoutineProposedParams }
  | { method: 'routine.result'; params: RoutineResultParams }
  | { method: 'routines.changed'; params: Record<string, never> };

export interface RoutinesOptions {
  store: RoutineStore;
  clock: WatchClock;
  /** The person's zone, read per tick so a change of zone is followed. */
  timeZone: () => string;
  /** Scout: the default pet. */
  pet: () => Pet | null;
  experts: () => readonly Expert[];
  /** Blind spots: a window behind one never triggers a routine. */
  exclusions: () => CaptureExclusions;
  /** Starts the turn, in the background: it neither stops nor is stopped by the person's own. */
  run: (ask: RoutineAsk) => RoutineTurn;
  /** Adds an expert's answer to the routine's conversation, so a follow-up continues it. */
  answer: (conversationId: string, text: string) => void;
  activity: {
    routineStarted(entry: { routineId: string; petId: string; name: string }): string;
    routineFinished(
      id: string,
      outcome: {
        state: 'done' | 'error';
        answer?: string | undefined;
        error?: string | undefined;
        conversationId?: string | undefined;
      },
    ): void;
  };
  /** What is open, titles only. Null while no host is connected. */
  windows: () => Promise<WindowEntry[] | null>;
  emit: (event: RoutineEvent) => void;
  log?: (message: string) => void;
}

interface RunContext {
  late: boolean;
  /** What triggered it: an expert's answer, a watch's message. */
  detail?: string | undefined;
}

interface Waiting {
  stored: StoredRoutine;
  context: RunContext;
  activityId: string;
  conversationId: string;
  expertName: string;
}

interface Proposal {
  petId: string;
  action: RoutineAction;
  routine: RoutineDraftInput;
  routineId?: string | undefined;
}

function firstLine(text: string): string {
  const line =
    text
      .trim()
      .split('\n')
      .find((part) => part.trim() !== '') ?? '';
  const sentence =
    line
      .trim()
      .match(/^.*?[.!?](\s|$)/)?.[0]
      ?.trim() ?? line.trim();
  return sentence.length > LINE_CHARS ? `${sentence.slice(0, LINE_CHARS - 1)}…` : sentence;
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

/**
 * Routines: runs each saved one when its time or its trigger comes, as a Scout turn with
 * Scout's normal tools, and delivers what it said. Saving is the person's consent for the
 * read-only work it does; anything that changes something still asks, every time.
 */
export class Routines {
  readonly #options: RoutinesOptions;
  #timer: unknown = null;
  #stopped = false;
  #ticking = false;
  readonly #running = new Set<string>();
  /** Runs waiting on a pre-approved hand-off, by hand-off id. */
  readonly #waiting = new Map<string, Waiting>();
  readonly #pending: RoutineResultParams[] = [];
  /** Whether each app routine's window was open at the last look. Absent: not looked yet. */
  readonly #seen = new Map<string, boolean>();
  readonly #proposals = new Map<string, Proposal>();

  constructor(options: RoutinesOptions) {
    this.#options = options;
  }

  /** Runs what is due (a slot missed while closed runs once, late) and the launch routines. */
  start(): void {
    this.#stopped = false;
    for (const stored of this.#enabled()) {
      if (stored.routine.when.type === 'launch') void this.#run(stored, { late: false });
    }
    void this.#tick();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) this.#options.clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  list(): RoutineView[] {
    return this.#options.store.list().map((stored) => this.#view(stored));
  }

  get(id: string): RoutineView | null {
    const stored = this.#options.store.get(id);
    return stored === null ? null : this.#view(stored);
  }

  save(routine: RoutineDraftInput & { id?: string | undefined }): RoutineView {
    const saved = this.#options.store.save(routine, this.#options.clock.now());
    this.#seen.delete(saved.id);
    this.#changed();
    return this.get(saved.id)!;
  }

  setEnabled(id: string, enabled: boolean): RoutineView | null {
    const routine = this.#options.store.setEnabled(id, enabled, this.#options.clock.now());
    if (routine === null) return null;
    this.#changed();
    return this.get(id);
  }

  delete(id: string): boolean {
    const deleted = this.#options.store.delete(id);
    this.#seen.delete(id);
    if (deleted) this.#changed();
    return deleted;
  }

  /** Home's Run now and the card's "Run it now to test?". Resolves when the turn is over. */
  async runNow(id: string): Promise<boolean> {
    const stored = this.#options.store.get(id);
    if (stored === null) return false;
    return this.#run(stored, { late: false });
  }

  /** Scout's card: nothing is saved until the person presses Save. */
  propose(proposal: Proposal): { proposalId: string } {
    const routine = RoutineDraft.parse(proposal.routine);
    const proposalId = randomUUID();
    this.#proposals.set(proposalId, proposal);
    const handToName =
      routine.handTo === undefined
        ? undefined
        : (this.#options.experts().find((e) => e.id === routine.handTo)?.name ?? routine.handTo);
    this.#options.emit({
      method: 'routine.proposed',
      params: {
        proposalId,
        petId: proposal.petId,
        action: proposal.action,
        routine,
        ...(proposal.routineId !== undefined ? { routineId: proposal.routineId } : {}),
        ...(handToName !== undefined ? { handToName } : {}),
      },
    });
    return { proposalId };
  }

  /** Save on the card: does what it said, with the person's edit when there is one. */
  confirm(params: { proposalId: string; routine?: RoutineDraftInput | undefined }): {
    routine?: RoutineView;
    deleted?: boolean;
  } {
    const proposal = this.#proposals.get(params.proposalId);
    if (proposal === undefined) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'that routine card is no longer waiting');
    }
    this.#proposals.delete(params.proposalId);
    const id = proposal.routineId;
    const gone = () =>
      new RpcFailure(RPC_ERROR_CODES.invalidParams, 'that routine is no longer saved');
    switch (proposal.action) {
      case 'create':
        return { routine: this.save(params.routine ?? proposal.routine) };
      case 'update': {
        if (id === undefined || this.#options.store.get(id) === null) throw gone();
        return { routine: this.save({ ...(params.routine ?? proposal.routine), id }) };
      }
      case 'pause':
      case 'resume': {
        const routine = id === undefined ? null : this.setEnabled(id, proposal.action === 'resume');
        if (routine === null) throw gone();
        return { routine };
      }
      case 'delete':
        return { deleted: id !== undefined && this.delete(id) };
    }
  }

  dismiss(proposalId: string): boolean {
    return this.#proposals.delete(proposalId);
  }

  /** An expert finished: a routine waiting on it delivers, and expert routines run. */
  handoffFinished(params: HandoffFinishedParams): void {
    const waiting = this.#waiting.get(params.handoffId);
    if (waiting !== undefined) {
      this.#waiting.delete(params.handoffId);
      const done = params.state === 'done';
      const text = done
        ? (params.text ?? '').trim() || `${waiting.expertName} finished with nothing to add.`
        : (params.error ?? `${waiting.expertName} stopped without finishing.`);
      if (done) this.#options.answer(waiting.conversationId, text);
      this.#finish(waiting.stored, waiting.context, waiting.activityId, {
        state: done ? 'done' : 'error',
        text,
        conversationId: waiting.conversationId,
      });
      void this.#deliver();
      return;
    }
    if (params.state !== 'done') return;
    const name = this.#options.experts().find((e) => e.id === params.expertId)?.name ?? 'An expert';
    const detail = `${name} finished: ${clip((params.text ?? '').trim(), DETAIL_CHARS)}`;
    for (const stored of this.#enabled()) {
      if (stored.routine.when.type === 'expert') void this.#run(stored, { late: false, detail });
    }
  }

  watchFired(message: string): void {
    const detail = `A watch fired: ${clip(message, DETAIL_CHARS)}`;
    for (const stored of this.#enabled()) {
      if (stored.routine.when.type === 'watch') void this.#run(stored, { late: false, detail });
    }
  }

  #enabled(): StoredRoutine[] {
    return this.#options.store.list().filter((stored) => stored.routine.enabled);
  }

  #view(stored: StoredRoutine): RoutineView {
    const { routine } = stored;
    const next =
      routine.when.type === 'schedule' && routine.enabled
        ? nextDue(routine.when, this.#options.clock.now(), this.#options.timeZone())
        : null;
    return {
      ...routine,
      ...(stored.lastRunAt !== undefined
        ? { lastRunAt: new Date(stored.lastRunAt).toISOString() }
        : {}),
      ...(stored.lastState !== undefined ? { lastState: stored.lastState } : {}),
      ...(stored.lastActivityId !== undefined ? { lastActivityId: stored.lastActivityId } : {}),
      ...(next !== null ? { nextRunAt: new Date(next).toISOString() } : {}),
    };
  }

  #changed(): void {
    this.#options.emit({ method: 'routines.changed', params: {} });
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const now = this.#options.clock.now();
      const zone = this.#options.timeZone();
      const enabled = this.#enabled();
      for (const stored of enabled) {
        const { when } = stored.routine;
        if (when.type !== 'schedule') continue;
        const slot = dueSlot(when, stored.lastDueAt, now, zone);
        if (slot === null) continue;
        // Written before the run, so a crash or a second tick never runs it twice.
        this.#options.store.markDue(stored.routine.id, slot);
        void this.#run(stored, { late: now - slot > LATE_AFTER_MS });
      }
      const apps = enabled.filter((stored) => stored.routine.when.type === 'app');
      if (apps.length > 0) await this.#watchApps(apps);
      await this.#deliver();
    } catch (error) {
      this.#options.log?.(`routines: a tick failed: ${String(error)}`);
    } finally {
      this.#ticking = false;
      if (!this.#stopped) {
        this.#timer = this.#options.clock.setTimeout(() => void this.#tick(), ROUTINE_TICK_MS);
      }
    }
  }

  async #watchApps(apps: StoredRoutine[]): Promise<void> {
    const windows = await this.#options.windows();
    if (windows === null) return;
    const exclusions = this.#options.exclusions();
    const visible = windows.filter(
      (w) =>
        w.state !== 'minimized' &&
        w.blocked === undefined &&
        findCaptureBlock({ processName: w.processName, title: w.title }, exclusions) === null,
    );
    for (const stored of apps) {
      const { when, id } = stored.routine;
      if (when.type !== 'app') continue;
      const match = when.match.toLowerCase();
      const open = visible.some(
        (w) => w.title.toLowerCase().includes(match) || w.processName.toLowerCase().includes(match),
      );
      const was = this.#seen.get(id);
      this.#seen.set(id, open);
      // Already open at the first look is not appearing.
      if (open && was === false) void this.#run(stored, { late: false });
    }
  }

  /** Says every waiting result, unless a full-screen app or a call is in front. */
  async #deliver(): Promise<void> {
    if (this.#pending.length === 0) return;
    const windows = await this.#options.windows();
    if (windows === null) return;
    const front = windows.find((w) => w.state === 'foreground');
    if (front !== undefined && (front.fullScreen === true || isMeeting(front))) return;
    for (const params of this.#pending.splice(0)) {
      this.#options.emit({ method: 'routine.result', params });
    }
  }

  #prompt(routine: Routine, context: RunContext): string {
    const expert =
      routine.handTo === undefined
        ? undefined
        : this.#options.experts().find((e) => e.id === routine.handTo && e.enabled);
    return [
      `[Routine "${routine.name}", ${describeWhen(routine.when).toLowerCase()}]`,
      routine.what,
      ...(routine.topics.trim() !== '' ? [`Topics: ${routine.topics.trim()}`] : []),
      ...(context.detail !== undefined ? [context.detail] : []),
      ...(context.late ? ['It ran late: the computer was asleep or Tagalong was closed.'] : []),
      'This ran on its own, so the person is not watching: answer them directly and briefly, ' +
        'as a message they will read later.',
      ...(expert !== undefined
        ? [
            `You may hand this to ${expert.name} (expert_id ${expert.id}) with hand_to_expert: ` +
              'it is already approved once per run, read-only, with web search and no project. ' +
              'Say in one line that it is on it; its answer reaches the person on its own.',
          ]
        : []),
    ].join('\n');
  }

  async #run(stored: StoredRoutine, context: RunContext): Promise<boolean> {
    const { routine } = stored;
    if (this.#running.has(routine.id)) return false;
    const pet = this.#options.pet();
    if (pet === null) return false;
    this.#running.add(routine.id);
    const activityId = this.#options.activity.routineStarted({
      routineId: routine.id,
      petId: pet.id,
      name: context.late ? `${routine.name} (ran late)` : routine.name,
    });
    this.#options.store.runStarted(routine.id, this.#options.clock.now(), activityId);
    this.#changed();

    const handoffs: string[] = [];
    try {
      const turn = this.#options.run({
        pet,
        text: this.#prompt(routine, context),
        routineId: routine.id,
        instruction: routine.what,
        ...(routine.handTo !== undefined ? { preApprovedExpertId: routine.handTo } : {}),
        handedOff: (handoffId) => handoffs.push(handoffId),
      });
      const outcome = await turn.done;
      const handoffId = handoffs[0];
      if (outcome.error === undefined && handoffId !== undefined) {
        // The expert's answer is the result; it arrives as handoff.finished.
        const expertName =
          this.#options.experts().find((e) => e.id === routine.handTo)?.name ?? 'The expert';
        this.#waiting.set(handoffId, {
          stored,
          context,
          activityId,
          conversationId: turn.conversationId,
          expertName,
        });
        return true;
      }
      this.#finish(stored, context, activityId, {
        state: outcome.error === undefined ? 'done' : 'error',
        text: outcome.error?.message ?? outcome.text,
        conversationId: turn.conversationId,
      });
    } catch (error) {
      try {
        this.#finish(stored, context, activityId, { state: 'error', text: String(error) });
      } catch (late) {
        // The engine is shutting down and the database has closed under the run.
        this.#running.delete(routine.id);
        this.#options.log?.(`routines: a run could not be recorded: ${String(late)}`);
        return true;
      }
    }
    await this.#deliver().catch(() => undefined);
    return true;
  }

  #finish(
    stored: StoredRoutine,
    context: RunContext,
    activityId: string,
    outcome: { state: 'done' | 'error'; text: string; conversationId?: string | undefined },
  ): void {
    const { routine } = stored;
    this.#running.delete(routine.id);
    const done = outcome.state === 'done';
    this.#options.activity.routineFinished(activityId, {
      state: outcome.state,
      ...(done ? { answer: outcome.text } : { error: outcome.text }),
      conversationId: outcome.conversationId,
    });
    this.#options.store.runFinished(routine.id, outcome.state);
    const label = context.late ? `${routine.name} (ran late)` : routine.name;
    const said = firstLine(outcome.text);
    const line = done
      ? said === ''
        ? `${label} ran, with nothing to say.`
        : `${label}: ${said}`
      : `${label} did not run: ${said || 'something went wrong.'}`;
    this.#pending.push({
      routineId: routine.id,
      name: routine.name,
      petId: this.#options.pet()?.id ?? 'scout',
      ...(outcome.conversationId !== undefined ? { conversationId: outcome.conversationId } : {}),
      state: outcome.state,
      line,
      text: outcome.text,
      late: context.late,
      deliver: routine.deliver,
      activityId,
    });
    this.#changed();
  }
}
