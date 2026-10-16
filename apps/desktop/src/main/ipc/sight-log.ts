/** IPC for Home's What Scout saw: list it, delete one row, delete all. Contains registerSightLogIpc. */

import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export function registerSightLogIpc(
  handle: IpcHandle,
  deps: { /** Throws when the engine is not running. */ engine: () => EngineCall },
): void {
  const { engine } = deps;
  handle(IPC.listSightLog, async () => {
    // The newest 200: about a day of ordinary use, and what Home shows in one page.
    const { entries } = await engine().call('sightLog.list', { limit: 200 });
    return entries;
  });
  handle(IPC.deleteSightLog, async (_event, id: string) => {
    const { deleted } = await engine().call('sightLog.delete', { id });
    return deleted;
  });
  handle(IPC.clearSightLog, async () => {
    const { deleted } = await engine().call('sightLog.clear', {});
    return deleted;
  });
}
