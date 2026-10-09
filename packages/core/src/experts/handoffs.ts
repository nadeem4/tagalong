import { RPC_ERROR_CODES, type Expert, type HandoffFinishedParams } from '@tagalong/protocol';
import type { ActivityLog } from '../memory/activity';
import { RpcFailure } from '../server/ws-server';
import { renderBrief, type Brief, type Connector } from './connector';
import type { ExpertStore } from './store';

export type HandoffEvent =
  | { method: 'handoff.progress'; params: { handoffId: string; expertId: string; step: string } }
  | { method: 'handoff.finished'; params: HandoffFinishedParams };

export interface HandoffManagerOptions {
  experts: ExpertStore;
  activity: ActivityLog;
  connectorFor: (expert: Expert) => Connector;
  emit: (event: HandoffEvent) => void;
}

/**
 * Runs hand-offs from companions to experts. `start` returns at once; the expert's steps
 * and its answer arrive as `handoff.progress` and `handoff.finished`, and every hand-off is
 * written to the activity log, so Home shows it whether or not a window was open.
 */
export class HandoffManager {
  readonly #running = new Map<string, AbortController>();
  /** Every unfinished run, so shutdown can wait for its last write before the database closes. */
  readonly #runs = new Set<Promise<void>>();

  constructor(private readonly options: HandoffManagerOptions) {}

  start(params: { expertId: string; petId: string; brief: Brief }): { handoffId: string } {
    const expert = this.options.experts.get(params.expertId);
    if (expert === null) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `no expert with id '${params.expertId}'`);
    }
    if (!expert.enabled) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `${expert.name} is switched off`);
    }
    const handoffId = this.options.activity.expertStarted({
      petId: params.petId,
      expertId: expert.id,
      expertName: expert.name,
      text: renderBrief(params.brief),
    });
    const controller = new AbortController();
    this.#running.set(handoffId, controller);
    const run = this.#run(handoffId, expert, params.brief, controller.signal).finally(() =>
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

  async #run(handoffId: string, expert: Expert, brief: Brief, signal: AbortSignal): Promise<void> {
    const { activity, emit } = this.options;
    const expertId = expert.id;
    const result = await this.options
      .connectorFor(expert)
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
