import { ConnectionsAddParams } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface ConnectionIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
}

/** Connected apps, and the answer to a change Scout asked to make in one. */
export function registerConnectionIpc(handle: IpcHandle, { engine }: ConnectionIpcDeps): void {
  handle(IPC.approveTool, async (_event, approvalId: string, decision: 'once' | 'deny') => {
    await engine().call('tool.approve', { approvalId, decision });
  });
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
