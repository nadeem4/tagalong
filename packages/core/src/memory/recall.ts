/**
 * What a turn remembers: recall picks the memories for one prompt. A preference the person
 * states is kept by the `remember` tool or the conversation summary, not by pattern.
 */
import type { Memory, MemoryStore } from './memories';

/** How many of the newest memories every turn carries. */
export const RECALL_RECENT = 5;

/** How many full-text matches against the question ride along on top of those. */
export const RECALL_MATCHES = 5;

/** The ceiling on remembered text per turn, so memory never crowds out the screen. */
export const RECALL_BUDGET_CHARS = 2000;

/**
 * What a pet remembers for one turn: its five newest memories, then up to five more that
 * share words with what was asked, best match first, trimmed to the character budget.
 *
 * Recent first because a preference stated a minute ago is the likeliest to matter; the
 * matches then reach back for something older that this question happens to be about.
 * The budget drops whole memories from the end rather than cutting one mid-sentence.
 */
export function recall(memories: MemoryStore, petId: string, query: string): Memory[] {
  const picked = memories.recent(petId, RECALL_RECENT);
  const seen = new Set(picked.map((memory) => memory.id));
  for (const memory of memories.search(petId, query, RECALL_MATCHES + picked.length)) {
    if (seen.has(memory.id)) continue;
    picked.push(memory);
    seen.add(memory.id);
    if (picked.length >= RECALL_RECENT + RECALL_MATCHES) break;
  }

  const kept: Memory[] = [];
  let used = 0;
  for (const memory of picked) {
    if (used + memory.text.length > RECALL_BUDGET_CHARS) continue;
    kept.push(memory);
    used += memory.text.length;
  }
  return kept;
}
