import type { Expert } from '@tagalong/protocol';
import type { ConfirmHandoff } from '@tagalong/ui';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface ExpertIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
}

/** Home's Activity and Experts tabs, and the hand-off card. */
export function registerExpertIpc(handle: IpcHandle, { engine }: ExpertIpcDeps): void {
  // Home's activity view.
  handle(IPC.listActivity, async (_event, params: { before?: string; limit?: number }) =>
    engine().call('activity.list', {
      limit: params.limit ?? 30,
      ...(params.before === undefined ? {} : { before: params.before }),
    }),
  );

  // Home's Spend card.
  handle(IPC.usageSummary, async () => engine().call('usage.summary', {}));

  // Home's Experts tab.
  handle(IPC.listExperts, async (): Promise<Expert[]> => {
    const result = await engine().call('experts.list', {});
    return result.experts;
  });
  handle(IPC.saveExpert, async (_event, expert: Expert): Promise<Expert> => {
    const result = await engine().call('experts.upsert', { expert });
    return result.expert;
  });
  handle(IPC.deleteExpert, async (_event, expertId: string): Promise<boolean> => {
    const result = await engine().call('experts.delete', { expertId });
    return result.deleted;
  });
  handle(IPC.testExpert, async (_event, expertId: string) =>
    engine().call('experts.test', { expertId }),
  );

  // The hand-off card.
  handle(IPC.confirmHandoff, async (_event, params: ConfirmHandoff) =>
    engine().call('handoffs.confirm', params),
  );
  handle(IPC.dismissHandoff, async (_event, proposalId: string) => {
    await engine().call('handoffs.dismiss', { proposalId });
  });
  handle(IPC.cancelHandoff, async (_event, handoffId: string) => {
    await engine().call('handoffs.cancel', { handoffId });
  });
  handle(IPC.searchProjects, async (_event, query: string) => {
    const { projects } = await engine().call('projects.search', { query });
    return projects;
  });
}
