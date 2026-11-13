/**
 * IPC for Home's What Scout remembers: list it, read the portrait, delete one memory. All go
 * through the brain's tools (list_memories, forget). Contains registerMemoryIpc.
 */

import type { MemoryEntry } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { RpcError } from '@tagalong/contract';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

interface BrainMemory {
  id: number;
  kind: string;
  text: string;
  at: string;
  tag?: string | null;
  source?: string | null;
  source_ref?: string | null;
  evidence?: string | null;
  visibility?: string | null;
  category?: string | null;
  span_start?: string | null;
  span_end?: string | null;
}

/** Home labels three kinds; the brain keeps more, so each lands on the nearest one. */
function homeKind(kind: string): MemoryEntry['kind'] {
  if (kind === 'summary') return 'summary';
  return kind === 'instruction' ? 'preference' : 'fact';
}

/** Provenance fields the brain leaves null for old rows are left out, not sent as null. */
function parseMemories(value: unknown): { entries: MemoryEntry[]; portrait: string | null } {
  const list = (value as { memories?: unknown } | null)?.memories;
  if (!Array.isArray(list)) throw new Error('brain sent bad memories');
  const portrait = (value as { portrait?: unknown }).portrait;
  const entries = (list as BrainMemory[]).map((m): MemoryEntry => ({
    id: String(m.id),
    kind: homeKind(m.kind),
    text: m.text,
    createdAt: m.at,
    ...(m.tag ? { tag: m.tag } : {}),
    ...(m.source ? { source: m.source } : {}),
    ...(m.source_ref ? { sourceRef: m.source_ref } : {}),
    ...(m.evidence ? { evidence: m.evidence } : {}),
    ...(m.visibility === 'free' || m.visibility === 'asked' ? { visibility: m.visibility } : {}),
    ...(m.category ? { category: m.category } : {}),
    ...(m.span_start ? { spanStart: m.span_start } : {}),
    ...(m.span_end ? { spanEnd: m.span_end } : {}),
  }));
  return { entries, portrait: typeof portrait === 'string' && portrait !== '' ? portrait : null };
}

export function registerMemoryIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  // The brain returns the newest 700, enough for a whole timeline.
  handle(IPC.listMemories, async () => {
    return parseMemories(await callJson(brain, 'list_memories')).entries;
  });
  // The portrait rides on the same brain call as the list.
  handle(IPC.getPortrait, async () => {
    return parseMemories(await callJson(brain, 'list_memories')).portrait;
  });
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
