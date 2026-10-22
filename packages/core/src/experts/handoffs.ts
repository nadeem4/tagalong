/**
 * Hand-offs from Scout to experts: proposal, confirm, run, steering notes, follow-up steps,
 * stop, and the Activity rows. Contains HandoffManager and its limits.
 */
import {
  RPC_ERROR_CODES,
  type Expert,
  type HandoffFinishedParams,
  type HandoffProgressParams,
  type HandoffProposedParams,
  type ProjectCandidate,
} from '@tagalong/protocol';
import type { Asks } from '../asks/asks';
import type { ActivityLog } from '../memory/activity';
import { hideSecrets } from '../privacy/secrets';
import { RpcFailure } from '../server/ws-server';
import { renderBrief, type Brief, type Connector, type ConnectorResult } from './connector';
import type { ExpertStore } from './store';
import type { UsageEntry } from '../usage/usage-log';

/** How long a hand-off may run before it is stopped and marked failed. */
export const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000;

/** How much of step 1's answer goes into step 2's brief, so a long answer cannot flood it. */
export const FOLLOW_UP_ANSWER_CHARS = 8_000;

/** The most notes that may wait for one run's turn to end; more are refused until it takes them. */
export const MAX_WAITING_NOTES = 5;

/** The most one note may be: a long dictation is cut, so a note cannot flood the session. */
export const NOTE_CHARS = 2_000;

/** How much of a running hand-off's ask names it to the companion: only its first line. */
export const RUNNING_ASK_CHARS = 100;

function clip(text: string, max = FOLLOW_UP_ANSWER_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export type HandoffEvent =
  | { method: 'handoff.proposed'; params: HandoffProposedParams }
  | { method: 'handoff.progress'; params: HandoffProgressParams }
  | { method: 'handoff.finished'; params: HandoffFinishedParams };

export interface HandoffManagerOptions {
  experts: ExpertStore;
  activity: ActivityLog;
  /** `research`: a routine's pre-approved hand-off, web only, with no project. */
  connectorFor: (expert: Expert, mode?: { research: boolean }) => Connector;
  emit: (event: HandoffEvent) => void;
  /** Guesses the project a brief is about, and remembers the one the person confirmed. */
  projects?: {
    suggest(windowTitle: string | undefined): ProjectCandidate[];
    remember(path: string): void;
  };
  /** The cost meter: every expert run that reports tokens is recorded here, and only here. */
  usage?: { record(entry: UsageEntry): void };
  /** Where a card waits for Send: saved, so it survives a restart. */
  asks: Pick<Asks, 'add' | 'get' | 'settle' | 'waiting'>;
}

export interface StartParams {
  expertId: string;
  petId: string;
  brief: Brief;
  /**
   * The project to work in. Required unless the expert works in its own folder; a folder
   * saved on the expert is never used.
   */
  folder?: string | undefined;
  canEdit?: boolean | undefined;
  /** A follow-up step that starts in the same folder once this one finishes well. */
  then?: FollowUp | undefined;
}

/** The second step of a chain, such as a Reviewer checking what a Coder changed. */
export interface FollowUp {
  expertId: string;
  ask: string;
  canEdit: boolean;
}

/** A hand-off that has started and not finished: who, what it was told, notes waiting. */
interface Live {
  expert: Expert;
  ask: string;
  /** What the Activity row says it was told: the brief, then each note passed on. */
  told: string;
  delivered: number;
  waiting: string[];
}

/**
 * What a card's ask row keeps to be sent after a restart: the brief without its screen
 * context (the window, the selection and the window text stay in memory only).
 */
interface Proposal {
  expertId: string;
  petId: string;
  brief: Omit<Brief, 'context'>;
  then?: { expertId: string; ask: string } | undefined;
}

/**
 * Runs hand-offs from companions to experts. A companion `propose`s: the brief and the
 * project guesses go to the person as `handoff.proposed`, and nothing runs until they
 * `confirm` it with a folder. `start` returns at once; the expert's steps and its answer
 * arrive as `handoff.progress` and `handoff.finished`, and every hand-off is written to the
 * activity log, so Home shows it whether or not a window was open.
 */
export class HandoffManager {
  /**
   * Every card proposed since launch, by ask id, with its screen context (undefined when it had
   * none). Never saved: a card missing here was proposed before a restart.
   */
  readonly #context = new Map<string, Brief['context']>();
  readonly #running = new Map<string, AbortController>();
  /** Every hand-off from its Activity row until it finishes, stopped ones included. */
  readonly #live = new Map<string, Live>();
  /** Every unfinished run, so shutdown can wait for its last write before the database closes. */
  readonly #runs = new Set<Promise<void>>();
  /** Set by `stopAll`: no follow-up step starts once shutdown has begun. */
  #closed = false;

  constructor(private readonly options: HandoffManagerOptions) {}

  /** Shows the brief to the person, with the project guesses best first. Nothing runs yet. */
  propose(params: {
    expertId: string;
    petId: string;
    brief: Brief;
    /** Titles to guess the project from instead of the brief's window, such as the editor's. */
    projectHint?: string;
    then?: { expertId: string; ask: string } | undefined;
    /** The turn whose tool put the card up, so what the person does with it is its outcome. */
    turnId?: string | undefined;
  }): { proposalId: string } {
    const expert = this.#expert(params.expertId);
    const next = params.then === undefined ? undefined : this.#expert(params.then.expertId);
    const { context, ...saved } = params.brief;
    const proposal: Proposal = {
      expertId: params.expertId,
      petId: params.petId,
      brief: { ...saved, ask: hideSecrets(saved.ask) },
      ...(params.then === undefined ? {} : { then: params.then }),
    };
    const { id: proposalId } = this.options.asks.add({
      petId: params.petId,
      expertId: params.expertId,
      summary: params.brief.ask,
      payload: proposal,
      originTurnId: params.turnId,
    });
    // A card declined in Home or expired ends without this manager: its window goes here.
    for (const id of this.#context.keys()) {
      if (this.options.asks.get(id)?.state !== 'waiting') this.#context.delete(id);
    }
    this.#context.set(proposalId, context);
    // Only the guesses: a folder saved on the expert is never offered, and with no guess
    // the hand-off card opens the folder picker.
    const projects =
      this.options.projects?.suggest(params.projectHint ?? context?.windowTitle) ?? [];
    this.#emitProposed(proposalId, expert, next, params.petId, params.brief, params.then, projects);
    return { proposalId };
  }

  /**
   * Open in Waiting on you: the card comes up again. Since launch it carries the window it
   * was written from; after a restart, only the saved brief, marked restored. False when it
   * no longer waits, or its expert is gone (then it ends cancelled).
   */
  reopen(proposalId: string): boolean {
    const proposal = this.#waiting(proposalId);
    if (proposal === null) return false;
    const expert = this.#usable(proposal.expertId);
    if (expert === null) {
      this.#unavailable(proposalId);
      return false;
    }
    const next = proposal.then === undefined ? null : this.#usable(proposal.then.expertId);
    const restored = !this.#context.has(proposalId);
    const context = this.#context.get(proposalId);
    const brief: Brief = context === undefined ? proposal.brief : { ...proposal.brief, context };
    this.#emitProposed(
      proposalId,
      expert,
      next ?? undefined,
      proposal.petId,
      brief,
      next === null ? undefined : proposal.then,
      this.options.projects?.suggest(context?.windowTitle) ?? [],
      restored,
    );
    return true;
  }

  #emitProposed(
    proposalId: string,
    expert: Expert,
    next: Expert | undefined,
    petId: string,
    brief: Brief,
    then: { expertId: string; ask: string } | undefined,
    projects: ProjectCandidate[],
    restored = false,
  ): void {
    this.options.emit({
      method: 'handoff.proposed',
      params: {
        proposalId,
        petId,
        expertId: expert.id,
        expertName: expert.name,
        brief,
        projects,
        canEdit: expert.connection.canEdit,
        ...(expert.connection.workspace === 'own' ? { ownFolder: true } : {}),
        ...(next === undefined || then === undefined
          ? {}
          : {
              then: {
                expertId: next.id,
                expertName: next.name,
                ask: then.ask,
                canEdit: next.connection.canEdit,
              },
            }),
        ...(restored ? { restored: true as const } : {}),
      },
    });
  }

  /** The saved card, while it waits; null once it is answered, expired or never was. */
  #waiting(proposalId: string): Proposal | null {
    const row = this.options.asks.get(proposalId);
    if (row?.kind !== 'handoff' || row.state !== 'waiting') return null;
    return row.payload as Proposal;
  }

  /** The card's expert was removed or switched off: the card ends, and nothing is sent. */
  #unavailable(proposalId: string): void {
    this.options.asks.settle(proposalId, 'cancelled', { note: 'expert-unavailable' });
    this.#context.delete(proposalId);
  }

  #usable(expertId: string): Expert | null {
    const expert = this.options.experts.get(expertId);
    return expert === null || !expert.enabled ? null : expert;
  }

  /** The person sent it: starts the hand-off in their folder and remembers the folder. */
  confirm(params: {
    proposalId: string;
    /** Left out for an expert that works in its own folder. */
    folder?: string | undefined;
    canEdit: boolean;
    brief?: Brief | undefined;
    /** Null: the person removed the follow-up step. Left out: it runs as proposed. */
    then?: { canEdit: boolean; ask?: string | undefined } | null | undefined;
  }): { handoffId: string } {
    const proposal = this.#waiting(params.proposalId);
    if (proposal === null) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'that hand-off is no longer waiting');
    }
    if (this.#usable(proposal.expertId) === null) {
      this.#unavailable(params.proposalId);
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'That expert is no longer available.');
    }
    const context = this.#context.get(params.proposalId);
    const proposed = proposal.then;
    const then: FollowUp | undefined =
      proposed === undefined || params.then === null
        ? undefined
        : {
            expertId: proposed.expertId,
            ask: params.then?.ask ?? proposed.ask,
            canEdit:
              params.then?.canEdit ??
              this.options.experts.get(proposed.expertId)?.connection.canEdit ??
              false,
          };
    const started = this.start({
      expertId: proposal.expertId,
      petId: proposal.petId,
      brief:
        params.brief ?? (context === undefined ? proposal.brief : { ...proposal.brief, context }),
      folder: params.folder,
      canEdit: params.canEdit,
      then,
    });
    this.options.asks.settle(params.proposalId, 'approved', { by: 'you' });
    this.#context.delete(params.proposalId);
    if (params.folder !== undefined) this.options.projects?.remember(params.folder);
    return started;
  }

  /**
   * The briefs still waiting for Send, read from the saved asks, for the board, the Now facts
   * and a pick-up: who and the ask, nothing else. The selection and the window a brief
   * carried are never saved.
   */
  pending(): { expertId: string; expertName: string; ask: string }[] {
    return this.options.asks.waiting().flatMap((row) => {
      if (row.kind !== 'handoff' || row.expertId === undefined) return [];
      const expert = this.options.experts.get(row.expertId);
      return expert === null
        ? []
        : [{ expertId: expert.id, expertName: expert.name, ask: row.summary }];
    });
  }

  /** Dismiss: the card ends declined, by the person. True when it was still waiting. */
  dismiss(proposalId: string): boolean {
    if (this.#waiting(proposalId) === null) return false;
    this.#context.delete(proposalId);
    return this.options.asks.settle(proposalId, 'declined', { by: 'you' });
  }

  start(params: StartParams): { handoffId: string } {
    const stored = this.#expert(params.expertId);
    const folder = params.folder;
    // An expert with its own folder never works in a project: its connector picks the folder.
    if (stored.connection.workspace === 'own') {
      const { folder: _folder, ...connection } = stored.connection;
      const expert: Expert = {
        ...stored,
        connection: { ...connection, canEdit: params.canEdit ?? stored.connection.canEdit },
      };
      return this.#begin(expert, params.petId, params.brief, false, params.then);
    }
    if (folder === undefined) {
      throw new RpcFailure(
        RPC_ERROR_CODES.invalidParams,
        `Choose a project folder for ${stored.name} to work in.`,
      );
    }
    const expert: Expert = {
      ...stored,
      connection: {
        ...stored.connection,
        folder,
        canEdit: params.canEdit ?? stored.connection.canEdit,
      },
    };
    return this.#begin(expert, params.petId, params.brief, false, params.then);
  }

  /**
   * A saved routine's hand-off, which its card already approved: starts at once with no
   * project, read-only, able to search the web. Nothing else may start a hand-off this way.
   */
  startReadOnly(params: { expertId: string; petId: string; brief: Brief }): { handoffId: string } {
    const stored = this.#expert(params.expertId);
    const { folder: _folder, ...connection } = stored.connection;
    const expert: Expert = { ...stored, connection: { ...connection, canEdit: false } };
    return this.#begin(expert, params.petId, params.brief, true);
  }

  #begin(
    expert: Expert,
    petId: string,
    brief: Brief,
    research: boolean,
    then?: FollowUp,
  ): { handoffId: string } {
    const { handoffId, launch } = this.#prepare(expert, petId, brief, research, then);
    launch();
    return { handoffId };
  }

  /**
   * Writes the Activity row and holds the run until `launch`, so a chain can name the next
   * step's id before that step reports anything.
   */
  #prepare(
    expert: Expert,
    petId: string,
    brief: Brief,
    research: boolean,
    then?: FollowUp,
  ): { handoffId: string; launch: () => void } {
    const told = renderBrief(brief);
    const handoffId = this.options.activity.expertStarted({
      petId,
      expertId: expert.id,
      expertName: expert.name,
      text: told,
    });
    const controller = new AbortController();
    this.#running.set(handoffId, controller);
    this.#live.set(handoffId, { expert, ask: brief.ask, told, delivered: 0, waiting: [] });
    const launch = (): void => {
      const run = this.#run(
        { handoffId, expert, petId, brief, research, then },
        controller.signal,
      ).finally(() => this.#runs.delete(run));
      this.#runs.add(run);
    };
    return { handoffId, launch };
  }

  /**
   * After a step that finished well: sets up its follow-up in the same folder, briefed with
   * what the first expert said and changed. Null when there is none, or it cannot start.
   */
  #followUp(
    first: Expert,
    petId: string,
    then: FollowUp | undefined,
    result: { text: string; changedFiles: string[] },
  ): { next: NonNullable<HandoffFinishedParams['next']>; launch: () => void } | null {
    if (then === undefined || this.#closed) return null;
    const stored = this.options.experts.get(then.expertId);
    if (stored === null || !stored.enabled) return null;
    const expert: Expert = {
      ...stored,
      connection: { ...stored.connection, folder: first.connection.folder, canEdit: then.canEdit },
    };
    const brief: Brief = {
      ask: `${then.ask}\n\nWhat ${first.name} did:\n${clip(result.text)}`,
      ...(result.changedFiles.length > 0 ? { files: result.changedFiles } : {}),
    };
    const { handoffId, launch } = this.#prepare(expert, petId, brief, false);
    return { next: { handoffId, expertId: expert.id, expertName: expert.name }, launch };
  }

  /**
   * The hand-offs running now, for Scout to name when the person wants to tell one something.
   * Only the first line of the ask, kept short: a chain's second ask carries the first
   * expert's answer, which must not reach the companion's tool list.
   */
  running(): { handoffId: string; expertId: string; expertName: string; ask: string }[] {
    return [...this.#live.entries()]
      .filter(([handoffId]) => this.#isLive(handoffId))
      .map(([handoffId, live]) => ({
        handoffId,
        expertId: live.expert.id,
        expertName: live.expert.name,
        ask: clip(live.ask.split('\n')[0]?.trim() ?? '', RUNNING_ASK_CHARS),
      }));
  }

  /**
   * Queues the person's words for a running expert. They go to it when its current turn
   * ends, in the same session; the run keeps its folder and its tools. A note still waiting
   * when the run ends is dropped, and the card says so.
   */
  steer(handoffId: string, text: string): { ok: true } | { ok: false; error: string } {
    const note = clip(hideSecrets(text.trim()), NOTE_CHARS);
    if (note === '') return { ok: false, error: 'There is nothing to pass on.' };
    const live = this.#live.get(handoffId);
    // Finished, stopped or never started: there is no session left to tell.
    if (live === undefined || !this.#isLive(handoffId)) {
      return { ok: false, error: 'That hand-off is not running, so there is no one to tell.' };
    }
    if (live.waiting.length >= MAX_WAITING_NOTES) {
      return {
        ok: false,
        error: `${live.expert.name} already has ${MAX_WAITING_NOTES} notes waiting; it gets them when its current step ends.`,
      };
    }
    live.waiting.push(note);
    this.options.emit({
      method: 'handoff.progress',
      params: { handoffId, expertId: live.expert.id, step: note, kind: 'note' },
    });
    return { ok: true };
  }

  /** The notes waiting for a run, taken once each: delivered on the card and in Activity. */
  #take(handoffId: string): string[] {
    const live = this.#live.get(handoffId);
    // Stopped or timed out: the notes stay waiting and are dropped as the run ends.
    if (live === undefined || live.waiting.length === 0 || !this.#isLive(handoffId)) return [];
    const notes = live.waiting.splice(0);
    for (const note of notes) {
      live.told +=
        live.delivered === 0 ? `\n\nPassed on while it worked:\n- ${note}` : `\n- ${note}`;
      live.delivered += 1;
      this.options.emit({
        method: 'handoff.progress',
        params: { handoffId, expertId: live.expert.id, step: note, kind: 'delivered' },
      });
    }
    this.options.activity.expertBriefed(handoffId, live.told);
    return notes;
  }

  /** The run is over: notes it never took are dropped, and the card says so. */
  #dropNotes(handoffId: string): void {
    const live = this.#live.get(handoffId);
    this.#live.delete(handoffId);
    for (const note of live?.waiting ?? []) {
      this.options.emit({
        method: 'handoff.progress',
        params: { handoffId, expertId: live!.expert.id, step: note, kind: 'dropped' },
      });
    }
  }

  /** Running and neither stopped nor past its time limit (a timeout aborts but stays listed). */
  #isLive(handoffId: string): boolean {
    const controller = this.#running.get(handoffId);
    return controller !== undefined && !controller.signal.aborted;
  }

  /** True when a running hand-off was stopped. */
  cancel(handoffId: string): boolean {
    const controller = this.#running.get(handoffId);
    if (controller === undefined) return false;
    controller.abort();
    this.#running.delete(handoffId);
    return true;
  }

  /** Cancels every running hand-off and resolves once each has recorded how it ended. */
  async stopAll(): Promise<void> {
    this.#closed = true;
    for (const handoffId of [...this.#running.keys()]) this.cancel(handoffId);
    await Promise.all([...this.#runs]);
  }

  #expert(expertId: string): Expert {
    const expert = this.options.experts.get(expertId);
    if (expert === null) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `no expert with id '${expertId}'`);
    }
    if (!expert.enabled) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `${expert.name} is switched off`);
    }
    return expert;
  }

  async #run(
    step: {
      handoffId: string;
      expert: Expert;
      petId: string;
      brief: Brief;
      research: boolean;
      then?: FollowUp | undefined;
    },
    signal: AbortSignal,
  ): Promise<void> {
    const { handoffId, expert, brief, research } = step;
    const { activity, emit } = this.options;
    const expertId = expert.id;
    // Past the limit the run is cancelled like a stop, but recorded as a failure.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.#running.get(handoffId)?.abort();
    }, HANDOFF_TIMEOUT_MS);
    let sent: ConnectorResult;
    try {
      sent = await this.options
        .connectorFor(expert, research ? { research: true } : undefined)
        .send(
          brief,
          (step, kind) =>
            emit({
              method: 'handoff.progress',
              params: { handoffId, expertId, step: hideSecrets(step), ...(kind ? { kind } : {}) },
            }),
          signal,
          { take: () => this.#take(handoffId) },
        );
    } catch (error) {
      sent = { ok: false, error: `${expert.name} could not run: ${(error as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
    if (sent.usage !== undefined) {
      try {
        this.options.usage?.record({
          source: 'expert',
          providerId: expert.connection.type,
          model: sent.usage.model,
          inputTokens: sent.usage.inputTokens,
          outputTokens: sent.usage.outputTokens,
        });
      } catch {
        // A meter that cannot write never changes how the hand-off ends.
      }
    }
    if (timedOut) {
      const minutes = Math.round(HANDOFF_TIMEOUT_MS / 60_000);
      sent = {
        ok: false,
        error: `${expert.name} took longer than ${minutes} minutes, so it was stopped.`,
      };
    }
    // An expert reads files for itself, so its answer can carry a key it read: hidden
    // before it is stored, shown or handed back to the companion.
    const result: ConnectorResult = sent.ok
      ? { ...sent, text: hideSecrets(sent.text) }
      : { ...sent, error: hideSecrets(sent.error) };
    this.#running.delete(handoffId);
    this.#dropNotes(handoffId);

    if (signal.aborted && !timedOut) {
      activity.expertFinished(handoffId, result, 'stopped');
      emit({ method: 'handoff.finished', params: { handoffId, expertId, state: 'stopped' } });
      return;
    }
    activity.expertFinished(handoffId, result);
    // Only a step that finished well hands on; a failed or stopped one ends the chain.
    const followUp = result.ok ? this.#followUp(expert, step.petId, step.then, result) : null;
    emit({
      method: 'handoff.finished',
      params: result.ok
        ? {
            handoffId,
            expertId,
            state: 'done',
            text: result.text,
            changedFiles: result.changedFiles,
            ...(followUp === null ? {} : { next: followUp.next }),
          }
        : { handoffId, expertId, state: 'error', error: result.error },
    });
    followUp?.launch();
  }
}
