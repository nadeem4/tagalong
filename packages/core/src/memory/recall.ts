/**
 * What a turn remembers: one relevance path for every prompt and check-in. It picks the
 * memories (preferences always, then the newest, then matches) and up to two recent jobs that
 * share words with the question. A preference the person states is kept by the `remember`
 * tool, the conversation summary or the digest, not by pattern.
 */
import { shortId } from '../jobs/board';
import { queryWords, type Memory, type MemoryStore } from './memories';

/** Preferences always ride, so a growing store cannot push them out. */
export const RECALL_PREFERENCES = 5;

/** How many of the newest other memories every turn carries. */
export const RECALL_RECENT = 3;

/** How many full-text matches against the question ride along on top of those. */
export const RECALL_MATCHES = 5;

/** The ceiling on remembered text per turn, so memory never crowds out the screen. */
export const RECALL_BUDGET_CHARS = 2000;

/** Finished jobs that match the question, and the ceiling on their lines. */
export const RECALL_JOBS = 2;
export const RECENT_WORK_BUDGET_CHARS = 500;
const RECENT_WORK_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;

/** A finished job, as recall reads it. */
export interface RecentJob {
  id: string;
  task: string;
  note: string | null;
  finishedAt: string | null;
}

export interface Recalled {
  memories: Memory[];
  /** `- (your job, 3 days ago, j-1b2c) "task": note` lines. */
  recentWork: string[];
}

/**
 * What a pet remembers for one turn. Whole items are dropped to fit a budget, never cut
 * mid-sentence: memories first in the order above, then recent work in its own budget.
 */
export function recall(
  memories: MemoryStore,
  petId: string,
  query: string,
  work?: { jobs: readonly RecentJob[]; now: Date },
): Recalled {
  const picked = [
    ...memories.recent(petId, RECALL_PREFERENCES, ['preference']),
    ...memories.recent(petId, RECALL_RECENT, ['fact', 'summary']),
  ];
  const seen = new Set(picked.map((memory) => memory.id));
  let matches = 0;
  for (const memory of memories.search(petId, query, RECALL_MATCHES + picked.length)) {
    if (seen.has(memory.id)) continue;
    picked.push(memory);
    seen.add(memory.id);
    if ((matches += 1) >= RECALL_MATCHES) break;
  }

  return {
    memories: withinBudget(picked, (memory) => memory.text, RECALL_BUDGET_CHARS),
    recentWork: work === undefined ? [] : recentWork(work.jobs, query, work.now),
  };
}

function recentWork(jobs: readonly RecentJob[], query: string, now: Date): string[] {
  const wanted = queryWords(query);
  if (wanted.size === 0) return [];
  const since = now.getTime() - RECENT_WORK_DAYS * DAY_MS;
  const scored = jobs.flatMap((job) => {
    const at = job.finishedAt === null ? Number.NaN : Date.parse(job.finishedAt);
    if (!(at >= since)) return [];
    const words = queryWords(`${job.task} ${job.note ?? ''}`, Number.MAX_SAFE_INTEGER);
    const score = [...wanted].filter((word) => words.has(word)).length;
    return score === 0 ? [] : [{ job, at, score }];
  });
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  const lines = scored.slice(0, RECALL_JOBS).map(({ job, at }) => {
    const days = Math.floor((now.getTime() - at) / DAY_MS);
    const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    const note = job.note?.trim() ? `: ${job.note.trim()}` : '';
    return `- (your job, ${ago}, ${shortId('j', job.id)}) "${job.task}"${note}`;
  });
  return withinBudget(lines, (line) => line, RECENT_WORK_BUDGET_CHARS);
}

function withinBudget<T>(items: readonly T[], text: (item: T) => string, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    if (used + text(item).length > budget) continue;
    kept.push(item);
    used += text(item).length;
  }
  return kept;
}
