/**
 * IPC for the pick-up card: Open (by item id, checked against the allowlist), Brief again and Not
 * now. Contains registerPickUpIpc.
 */

import { IPC } from '../../shared/ipc';
import type { PickUpAllowlist } from '../pick-up-open';
import type { EngineCall, IpcHandle } from './handle';

export interface PickUpIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** The projects of the pick-up last shown: the only ones Open may reach. */
  allowlist: PickUpAllowlist;
  /** `shell.openExternal` and `shell.openPath`: nothing else, no keys or mouse driven. */
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
}

export function registerPickUpIpc(handle: IpcHandle, deps: PickUpIpcDeps): void {
  const { engine, allowlist } = deps;

  handle(IPC.openPickUp, async (_event, itemId: string) => {
    const open = allowlist.open(itemId);
    if (open === null) throw new Error('Tagalong only opens what this pick-up named.');
    if ('external' in open) {
      await deps.openExternal(open.external);
      return;
    }
    const problem = await deps.openPath(open.path);
    if (problem.length > 0) throw new Error(problem);
  });
  handle(IPC.rebriefPickUp, async (_event, itemId: string) => {
    await engine().call('pickUp.rebrief', { itemId });
  });
  handle(IPC.dismissPickUp, async () => {
    allowlist.clear();
    await engine().call('pickUp.dismiss', {});
  });
}
