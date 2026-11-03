/**
 * The job page's state: pages from the brain's job_activity fold into one list ordered by seq
 * (an entry the brain updates in place arrives again with the same seq and a higher rev), and the
 * page header fields (title, Scout's result, times, parts) are replaced by each page.
 * Contains LogState, PartView, emptyLog and applyPage.
 */
import type { JobActivityEntry, JobActivityPage, WatchItem } from '../host-bridge';

/** One expert hand-off as the tabs show it. */
export interface PartView {
  id: string;
  expert: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
}

export interface LogState {
  entries: JobActivityEntry[];
  /** The next `afterRev` to ask for. */
  rev: number;
  state: string;
  /** Scout's watch list from the latest page (each page carries the whole list). */
  watch: WatchItem[] | null;
  /** Null until a page says otherwise; the job row's own values fill in before that. */
  title: string | null;
  result: string | null;
  parts: PartView[] | null;
  startedAt: string | null;
  endedAt: string | null;
}

export function emptyLog(): LogState {
  return {
    entries: [],
    rev: 0,
    state: 'running',
    watch: null,
    title: null,
    result: null,
    parts: null,
    startedAt: null,
    endedAt: null,
  };
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
    title: page.title,
    result: page.result,
    parts: page.parts.map((p) => ({
      id: p.id,
      expert: p.expert,
      state: p.state,
      startedAt: p.started_at,
      endedAt: p.ended_at,
    })),
    startedAt: page.started_at,
    endedAt: page.ended_at,
  };
}
