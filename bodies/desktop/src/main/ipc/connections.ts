/**
 * IPC for Home's connected apps and the answer to a change Scout asked to make in one. Contains
 * registerConnectionIpc.
 */

import { ErrorCode } from '@tagalong/contract';
import { ConnectionsAddParams } from '@tagalong/protocol';
import { RpcError } from '../brain/brain-client';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface ConnectionIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** The person's click on a card: the brain's `answer` for that ask. */
  answer: (ask: string, decision: 'once' | 'always' | 'deny') => Promise<void>;
  /** The answer to a Claude Code job's ask: its own option name, plus typed text for a question. */
  reply: (ask: string, option: string, text?: string) => Promise<void>;
}

export function registerConnectionIpc(
  handle: IpcHandle,
  { engine, answer, reply }: ConnectionIpcDeps,
): void {
  // An ask the brain no longer has needs no answer; the card goes with its closed frame.
  // Anything else (offline, a failed send) rejects, so the card stays up to click again.
  const unlessGone = async (send: () => Promise<void>): Promise<void> => {
    try {
      await send();
    } catch (e) {
      if (e instanceof RpcError && e.code === ErrorCode.not_found) return;
      throw e;
    }
  };
  handle(
    IPC.approveTool,
    async (_event, approvalId: string, decision: 'once' | 'always' | 'deny') =>
      unlessGone(() => answer(approvalId, decision)),
  );
  handle(
    IPC.answerJobAsk,
    async (_event, approvalId: string, a: { option: string; text?: string }) =>
      unlessGone(() => reply(approvalId, a.option, a.text)),
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
