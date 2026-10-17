/** IPC for Home's What Scout remembers: list it, delete one memory. Contains registerMemoryIpc. */

import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export function registerMemoryIpc(
  handle: IpcHandle,
  deps: { /** Throws when the engine is not running. */ engine: () => EngineCall },
): void {
  const { engine } = deps;
  handle(IPC.listMemories, async () => {
    // The newest 200: what Home shows in one page.
    const { memories } = await engine().call('memory.list', { limit: 200 });
    return memories;
  });
  handle(IPC.deleteMemory, async (_event, id: string) => {
    const { deleted } = await engine().call('memory.delete', { id });
    return deleted;
  });
}
