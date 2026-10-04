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

/** The longest stated preference worth keeping verbatim. */
const MAX_PREFERENCE_CHARS = 200;

/** Phrases that announce something lasting about how the user wants to be answered. */
const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\bI (?:really |strongly )?prefer\b/i,
  /\bfrom now on\b/i,
  /\bremember that\b/i,
  /\b(?:always|never) (?:answer|reply|respond|use|write|explain|keep)\b/i,
  /\bI(?:'d| would) like (?:you|your answers|answers)\b/i,
];

/**
 * The sentence in which the user states a lasting preference, or null.
 *
 * A safety net under the `remember` tool: a model may or may not decide to save "I prefer
 * short answers", and the acceptance promise — the pet still keeps answers short after a
 * restart — should not hinge on that choice. Questions are skipped, so "which do you
 * prefer?" is not mistaken for a preference.
 */
export function statedPreference(text: string): string | null {
  for (const match of text.matchAll(/[^.!?\n]+[.!?]?/g)) {
    const sentence = match[0].trim();
    if (sentence.length === 0 || sentence.endsWith('?')) continue;
    if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(sentence))) {
      return sentence.slice(0, MAX_PREFERENCE_CHARS);
    }
  }
  return null;
}
