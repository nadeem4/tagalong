import { randomUUID } from 'node:crypto';
import type { ConnectorConfirmParams } from '@tagalong/protocol';

export type ApprovalAnswer = 'allowed' | 'cancelled' | 'timeout';

/** Two minutes to press Allow once; after that the change is dropped. */
export const APPROVAL_TIMEOUT_MS = 2 * 60_000;

/**
 * Changes waiting for the person. `ask` shows the confirm card (`connector.confirm`) and
 * resolves when they answer with `tool.approve`, when the turn is stopped, or when nobody
 * answers in time. Only an explicit Allow once runs anything.
 */
export class Approvals {
  readonly #waiting = new Map<string, (answer: ApprovalAnswer) => void>();

  constructor(
    private readonly show: (params: ConnectorConfirmParams) => void,
    private readonly timeoutMs: number = APPROVAL_TIMEOUT_MS,
  ) {}

  ask(
    params: Omit<ConnectorConfirmParams, 'approvalId'>,
    signal: AbortSignal,
  ): Promise<ApprovalAnswer> {
    const approvalId = randomUUID();
    return new Promise((resolve) => {
      const finish = (answer: ApprovalAnswer) => {
        if (!this.#waiting.delete(approvalId)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(answer);
      };
      const onAbort = () => finish('cancelled');
      const timer = setTimeout(() => finish('timeout'), this.timeoutMs);
      this.#waiting.set(approvalId, finish);
      if (signal.aborted) {
        finish('cancelled');
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.show({ approvalId, ...params });
    });
  }

  /** True when a waiting change was answered. */
  answer(approvalId: string, decision: 'once' | 'deny'): boolean {
    const finish = this.#waiting.get(approvalId);
    if (finish === undefined) return false;
    finish(decision === 'deny' ? 'cancelled' : 'allowed');
    return true;
  }
}
