/**
 * IPC for Home's connected apps and the answer to a change Scout asked to make in one. Contains
 * registerConnectionIpc.
 */

import { ConnectionsAddParams } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface ConnectionIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** The person's click on a card: the brain's `answer` for that ask. */
  answer: (ask: string, decision: 'once' | 'always' | 'deny') => Promise<void>;
}

export function registerConnectionIpc(
  handle: IpcHandle,
  { engine, answer }: ConnectionIpcDeps,
): void {
  handle(
    IPC.approveTool,
    async (_event, approvalId: string, decision: 'once' | 'always' | 'deny') => {
      // The card is already gone; an ask that closed or a brain that dropped has nobody to tell.
      await answer(approvalId, decision).catch(() => undefined);
    },
  );
  handle(IPC.listConnections, async () => engine().call('connections.list', {}));
  handle(IPC.addConnection, async (_event, params: ConnectionsAddParams) => {
    // Parsed here so the defaults (no args, no env) are filled before the call goes out.
    const { connection } = await engine().call(
      'connections.add',
      ConnectionsAddParams.parse(params),
    );
    return connection;
  });
  handle(IPC.setConnectionEnabled, async (_event, id: string, enabled: boolean) => {
    const { connection } = await engine().call('connections.setEnabled', { id, enabled });
    return connection;
  });
  handle(IPC.signInConnection, async (_event, id: string) => {
    const { connection } = await engine().call('connections.signIn', { id });
    return connection;
  });
  handle(IPC.removeConnection, async (_event, id: string) => {
    const { removed } = await engine().call('connections.remove', { id });
    return removed;
  });
}
