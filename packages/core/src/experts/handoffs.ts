import { randomUUID } from 'node:crypto';
import {
  RPC_ERROR_CODES,
  type Expert,
  type HandoffFinishedParams,
  type HandoffProposedParams,
  type ProjectCandidate,
} from '@tagalong/protocol';
import type { ActivityLog } from '../memory/activity';
import { hideSecrets } from '../privacy/secrets';
import { RpcFailure } from '../server/ws-server';
import { renderBrief, type Brief, type Connector, type ConnectorResult } from './connector';
import type { ExpertStore } from './store';
import type { UsageEntry } from '../usage/usage-log';

/** How long a hand-off may run before it is stopped and marked failed. */
export const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000;

export type HandoffEvent =
  | { method: 'handoff.proposed'; params: HandoffProposedParams }
  | { method: 'handoff.progress'; params: { handoffId: string; expertId: string; step: string } }
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
}

export interface StartParams {
  expertId: string;
  petId: string;
  brief: Brief;
  /** The project to work in. Required: an old expert's default folder is ignored. */
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

/** A brief waiting for the person to confirm it. */
interface Proposal {
  expertId: string;
  petId: string;
  brief: Brief;
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
  readonly #proposals = new Map<string, Proposal>();
  readonly #running = new Map<string, AbortController>();
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
  }): { proposalId: string } {
    const expert = this.#expert(params.expertId);
    const next = params.then === undefined ? undefined : this.#expert(params.then.expertId);
    // Only the guesses: an old expert's default folder is ignored, and with no guess at all
    // the hand-off card opens the folder picker.
    const projects =
      this.options.projects?.suggest(params.projectHint ?? params.brief.context?.windowTitle) ?? [];
    const proposalId = randomUUID();
    this.#proposals.set(proposalId, {
      expertId: params.expertId,
      petId: params.petId,
      brief: params.brief,
      then: params.then,
    });
    this.options.emit({
      method: 'handoff.proposed',
      params: {
        proposalId,
        petId: params.petId,
        expertId: expert.id,
        expertName: expert.name,
        brief: params.brief,
        projects,
        canEdit: expert.connection.canEdit,
        ...(next === undefined || params.then === undefined
          ? {}
          : {
              then: {
                expertId: next.id,
                expertName: next.name,
                ask: params.then.ask,
                canEdit: next.connection.canEdit,
              },
            }),
      },
    });
    return { proposalId };
  }

  /** The person sent it: starts the hand-off in their folder and remembers the folder. */
  confirm(params: {
    proposalId: string;
    folder: string;
    canEdit: boolean;
    brief?: Brief | undefined;
    /** Null: the person removed the follow-up step. Left out: it runs as proposed. */
    then?: { canEdit: boolean; ask?: string | undefined } | null | undefined;
  }): { handoffId: string } {
    const proposal = this.#proposals.get(params.proposalId);
    if (proposal === undefined) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'that hand-off is no longer waiting');
    }
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
      brief: params.brief ?? proposal.brief,
      folder: params.folder,
      canEdit: params.canEdit,
      then,
    });
    this.#proposals.delete(params.proposalId);
    this.options.projects?.remember(params.folder);
    return started;
  }

  /**
   * The briefs still waiting for Send, for a pick-up: who and the ask, nothing else. The
   * selection and the window a brief carried stay here.
   */
  pending(): { expertId: string; expertName: string; ask: string }[] {
    return [...this.#proposals.values()].flatMap((proposal) => {
      const expert = this.options.experts.get(proposal.expertId);
      return expert === null
        ? []
        : [{ expertId: expert.id, expertName: expert.name, ask: proposal.brief.ask }];
    });
  }

  /** True when a waiting proposal was dropped. */
  dismiss(proposalId: string): boolean {
    return this.#proposals.delete(proposalId);
  }

  start(params: StartParams): { handoffId: string } {
    const stored = this.#expert(params.expertId);
    const folder = params.folder;
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
    const handoffId = this.options.activity.expertStarted({
      petId,
      expertId: expert.id,
      expertName: expert.name,
      text: renderBrief(brief),
    });
    const controller = new AbortController();
    this.#running.set(handoffId, controller);
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
      ask: `${then.ask}\n\nWhat ${first.name} did:\n${result.text}`,
      ...(result.changedFiles.length > 0 ? { files: result.changedFiles } : {}),
    };
    const { handoffId, launch } = this.#prepare(expert, petId, brief, false);
    return { next: { handoffId, expertId: expert.id, expertName: expert.name }, launch };
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
          (step) =>
            emit({
              method: 'handoff.progress',
              params: { handoffId, expertId, step: hideSecrets(step) },
            }),
          signal,
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
