import { randomUUID } from 'node:crypto';
import {
  RPC_ERROR_CODES,
  type Expert,
  type HandoffFinishedParams,
  type HandoffProposedParams,
  type ProjectCandidate,
} from '@tagalong/protocol';
import type { ActivityLog } from '../memory/activity';
import { RpcFailure } from '../server/ws-server';
import { renderBrief, type Brief, type Connector } from './connector';
import type { ExpertStore } from './store';

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
}

export interface StartParams {
  expertId: string;
  petId: string;
  brief: Brief;
  /** The project to work in. Required: an old expert's default folder is ignored. */
  folder?: string | undefined;
  canEdit?: boolean | undefined;
}

/** A brief waiting for the person to confirm it. */
interface Proposal {
  expertId: string;
  petId: string;
  brief: Brief;
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

  constructor(private readonly options: HandoffManagerOptions) {}

  /** Shows the brief to the person, with the project guesses best first. Nothing runs yet. */
  propose(params: { expertId: string; petId: string; brief: Brief }): { proposalId: string } {
    const expert = this.#expert(params.expertId);
    // Only the guesses: an old expert's default folder is ignored, and with no guess at all
    // the hand-off card opens the folder picker.
    const projects = this.options.projects?.suggest(params.brief.context?.windowTitle) ?? [];
    const proposalId = randomUUID();
    this.#proposals.set(proposalId, params);
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
  }): { handoffId: string } {
    const proposal = this.#proposals.get(params.proposalId);
    if (proposal === undefined) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'that hand-off is no longer waiting');
    }
    const started = this.start({
      ...proposal,
      brief: params.brief ?? proposal.brief,
      folder: params.folder,
      canEdit: params.canEdit,
    });
    this.#proposals.delete(params.proposalId);
    this.options.projects?.remember(params.folder);
    return started;
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
    return this.#begin(expert, params.petId, params.brief, false);
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

  #begin(expert: Expert, petId: string, brief: Brief, research: boolean): { handoffId: string } {
    const handoffId = this.options.activity.expertStarted({
      petId,
      expertId: expert.id,
      expertName: expert.name,
      text: renderBrief(brief),
    });
    const controller = new AbortController();
    this.#running.set(handoffId, controller);
    const run = this.#run(handoffId, expert, brief, research, controller.signal).finally(() =>
      this.#runs.delete(run),
    );
    this.#runs.add(run);
    return { handoffId };
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
    handoffId: string,
    expert: Expert,
    brief: Brief,
    research: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const { activity, emit } = this.options;
    const expertId = expert.id;
    const result = await this.options
      .connectorFor(expert, research ? { research: true } : undefined)
      .send(
        brief,
        (step) => emit({ method: 'handoff.progress', params: { handoffId, expertId, step } }),
        signal,
      );
    this.#running.delete(handoffId);

    if (signal.aborted) {
      activity.expertFinished(handoffId, result, 'stopped');
      emit({ method: 'handoff.finished', params: { handoffId, expertId, state: 'stopped' } });
      return;
    }
    activity.expertFinished(handoffId, result);
    emit({
      method: 'handoff.finished',
      params: result.ok
        ? {
            handoffId,
            expertId,
            state: 'done',
            text: result.text,
            changedFiles: result.changedFiles,
          }
        : { handoffId, expertId, state: 'error', error: result.error },
    });
  }
}
