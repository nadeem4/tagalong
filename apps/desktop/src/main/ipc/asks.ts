/**
 * IPC for Home's Waiting on you: the list of asks, Allow once and Decline, and Open, which
 * brings a hand-off card up again in the bubble. Contains registerAskIpc.
 */

import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface AskIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
}

export function registerAskIpc(handle: IpcHandle, { engine }: AskIpcDeps): void {
  handle(IPC.listAsks, async () => engine().call('asks.list', {}));
  handle(IPC.answerAsk, async (_event, id: string, decision: 'approve' | 'decline') => {
    const { accepted } = await engine().call('asks.answer', { id, decision });
    return accepted;
  });
  handle(IPC.openAsk, async (_event, id: string) => {
    const { opened } = await engine().call('asks.open', { id });
    return opened;
  });
}
