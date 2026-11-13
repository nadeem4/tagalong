/**
 * The memory timeline, built from the flat list: one block per year (newest first), each year
 * grouped by the model's category, quiet years folded into one range, undated facts last.
 * Pure and React-free so Home and its tests share it. Contains buildTimeline.
 */
import type { MemoryEntry } from './memory';

export interface TimelineFact {
  entry: MemoryEntry;
  /** "2019–2021", "since 2019", or null for a single year. */
  range: string | null;
}
export interface CategoryGroup {
  category: string;
  facts: TimelineFact[];
}
export type TimelineBlock =
  | { kind: 'year'; year: string; groups: CategoryGroup[] }
  | { kind: 'quiet'; from: string; to: string };
export interface Timeline {
  years: TimelineBlock[];
  undated: CategoryGroup[];
  /** "2012–2026": first start to the last end or start; null when nothing is dated. */
  covered: string | null;
}

const OTHER = 'Other';

function rangeOf(entry: MemoryEntry, start: string): string | null {
  if (!entry.spanEnd) return `since ${start}`;
  return entry.spanEnd === start ? null : `${start}–${entry.spanEnd}`;
}

/** Groups in first-seen order, uncategorised facts ("Other") last. */
function group(facts: TimelineFact[]): CategoryGroup[] {
  const by = new Map<string, TimelineFact[]>();
  for (const fact of facts) {
    const category = fact.entry.category?.trim() || OTHER;
    by.set(category, [...(by.get(category) ?? []), fact]);
  }
  const groups = [...by].map(([category, list]) => ({ category, facts: list }));
  return [
    ...groups.filter((g) => g.category !== OTHER),
    ...groups.filter((g) => g.category === OTHER),
  ];
}

export function buildTimeline(entries: MemoryEntry[]): Timeline {
  const dated = new Map<number, TimelineFact[]>();
  const undated: TimelineFact[] = [];
  let last = 0;
  for (const entry of entries) {
    if (entry.kind !== 'fact') continue;
    if (!entry.spanStart) {
      undated.push({ entry, range: null });
      continue;
    }
    const year = Number(entry.spanStart);
    dated.set(year, [
      ...(dated.get(year) ?? []),
      { entry, range: rangeOf(entry, entry.spanStart) },
    ]);
    last = Math.max(last, Number(entry.spanEnd ?? entry.spanStart));
  }

  const starts = [...dated.keys()].sort((a, b) => b - a);
  const years: TimelineBlock[] = [];
  starts.forEach((year, i) => {
    years.push({ kind: 'year', year: String(year), groups: group(dated.get(year) ?? []) });
    const older = starts[i + 1];
    if (older !== undefined && year - older > 1) {
      years.push({ kind: 'quiet', from: String(older + 1), to: String(year - 1) });
    }
  });

  const first = starts[starts.length - 1];
  return {
    years,
    undated: group(undated),
    covered: first === undefined ? null : `${first}–${last}`,
  };
}
