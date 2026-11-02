/**
 * The job page's log state: pages from the brain's job_activity fold into one list ordered by
 * seq. An entry the brain updates in place arrives again with the same seq and a higher rev.
 * Contains LogState, emptyLog and applyPage.
 */
import type { JobActivityEntry, JobActivityPage, WatchItem } from '../host-bridge';

export interface LogState {
  entries: JobActivityEntry[];
  /** The next `afterRev` to ask for. */
  rev: number;
  state: string;
  /** Scout's watch list from the latest page (each page carries the whole list). */
  watch: WatchItem[] | null;
}

export function emptyLog(): LogState {
  return { entries: [], rev: 0, state: 'running', watch: null };
}

/** Pure: the caller makes sure the page belongs to the job being watched. */
export function applyPage(log: LogState, page: JobActivityPage): LogState {
  const bySeq = new Map(log.entries.map((e) => [e.seq, e]));
  for (const entry of page.entries) bySeq.set(entry.seq, entry);
  return {
    entries: [...bySeq.values()].sort((a, b) => a.seq - b.seq),
    rev: Math.max(log.rev, page.rev),
    state: page.state,
    watch: page.watch,
  };
}
