/**
 * IPC for Home's What Scout remembers: list it, delete one memory. Both go through the brain's
 * tools (list_memories, forget). Contains registerMemoryIpc.
 */

import type { MemoryEntry } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { RpcError } from '../brain/brain-client';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

interface BrainMemory {
  id: number;
  kind: string;
  text: string;
  at: string;
}

/** Home labels three kinds; the brain keeps more, so each lands on the nearest one. */
function homeKind(kind: string): MemoryEntry['kind'] {
  if (kind === 'summary') return 'summary';
  return kind === 'instruction' ? 'preference' : 'fact';
}

function parseMemories(value: unknown): MemoryEntry[] {
  const list = (value as { memories?: unknown } | null)?.memories;
  if (!Array.isArray(list)) throw new Error('brain sent bad memories');
  return (list as BrainMemory[]).map((m) => ({
    id: String(m.id),
    kind: homeKind(m.kind),
    text: m.text,
    createdAt: m.at,
  }));
}

export function registerMemoryIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  // The brain returns the newest 200: what Home shows in one page.
  handle(IPC.listMemories, async () => parseMemories(await callJson(brain, 'list_memories')));
  handle(IPC.deleteMemory, async (_event, id: string) => {
    // Brain ids are integers; anything else is not a memory it could have issued.
    if (!/^\d+$/.test(id)) return false;
    try {
      await brain.call('forget', { id: Number(id) });
      return true;
    } catch (error) {
      // The brain refused (no such memory): not deleted. Offline and the rest still reject.
      if (error instanceof RpcError) return false;
      throw error;
    }
  });
}
