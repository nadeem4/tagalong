/**
 * IPC for what a remote brain waits on from this PC, and the list of what this PC lets it run.
 * A failed run comes back as `{ error }` with the sentence, so Electron does not wrap it.
 * Contains registerNeedsYouIpc.
 */
import { IPC } from '../../shared/ipc';
import type { createNeedsYou } from '../node/needs';
import type { IpcHandle } from './handle';

export function registerNeedsYouIpc(
  handle: IpcHandle,
  deps: { needs: ReturnType<typeof createNeedsYou> },
): void {
  const { needs } = deps;
  handle(IPC.needsYouList, () => needs.list());
  handle(IPC.needsYouAct, (_event, id: unknown) => needs.act(String(id)));
  handle(IPC.needsYouNotNow, (_event, id: unknown) => needs.notNow(String(id)));
  handle(IPC.approvedList, () => needs.approved());
  handle(IPC.approvedRevoke, (_event, key: unknown) => needs.revoke(String(key)));
}
