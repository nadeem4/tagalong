import type { ActivityEntry, SightLogEntry } from '@tagalong/protocol';
import type { PickUpSnapshot } from '../../pick-up/store';
import { hideSecrets } from '../../privacy/secrets';
import type { BrainTool } from '../../providers';
import { defineTool, type Tool } from '../tool';

/**
 * "What did we do today?": one read over the records Tagalong already keeps (the log of
 * what Scout saw, the activity record, pick-up and the briefs waiting for Send). Nothing
 * is tracked in the background for it, and no answer an expert or a turn gave is passed on.
 */
export const RECALL_DAY = 'recall_day';

/** The most the tool hands back. */
export const DAY_CHARS = 4_000;
/** A question or a brief is clipped to this. */
const LINE_CHARS = 120;
/** At most this many looks are read for one day. */
const SIGHT_LIMIT = 1_000;
const MAX_GROUPS = 12;

export interface DayToolDeps {
  /** Oldest first, rows at or after `startIso` and before `untilIso`. */
  activity: { since(startIso: string, limit?: number, untilIso?: string): ActivityEntry[] };
  /** Newest first, rows at or after `since` and before `until`. */
  sightLog: { list(limit?: number, since?: string, until?: string): SightLogEntry[] };
  /** The pick-up snapshot. Absent, or null, when `settings.pickUp` is off. */
  pickUp?: { get(): PickUpSnapshot | null } | undefined;
  handoffs: { pending(): { expertId: string; expertName: string; ask: string }[] };
  now: () => Date;
}

const DEFINITION: BrainTool = {
  name: RECALL_DAY,
  description:
    'What the person did today or yesterday, from what you looked at and were asked: the apps ' +
    'and windows you saw, their questions, what experts and routines did, and what is still ' +
    'open. Use it for "what did we do today?" or "how much did I work yesterday?". It only ' +
    'knows what you looked at or were asked, and its hours are an estimate; say both.',
  inputSchema: {
    type: 'object',
    properties: {
      day: { type: 'string', enum: ['today', 'yesterday'], description: 'Defaults to today.' },
    },
  },
};

/**
 * "about N hours" from the first time to the last, or null with fewer than two. Breaks
 * are not subtracted, which is why it is only ever called an estimate.
 */
export function estimateSpan(times: readonly string[]): string | null {
  if (times.length < 2) return null;
  const ms = times.map((time) => Date.parse(time));
  const minutes = Math.round((Math.max(...ms) - Math.min(...ms)) / 60_000);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 30) / 2;
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function recallDayTool(deps: DayToolDeps): Tool {
  return defineTool(DEFINITION, 'read', (input, ctx) => {
    const day = dayOf(input);
    if (day === null) {
      return Promise.resolve({
        content: "day must be 'today' or 'yesterday'.",
        isError: true,
      });
    }
    try {
      return Promise.resolve({ content: briefing(deps, day, ctx.turnId) });
    } catch {
      return Promise.resolve({
        content: 'Tagalong could not read its records just now.',
        isError: true,
      });
    }
  });
}

function dayOf(input: unknown): 'today' | 'yesterday' | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const day = (input as { day?: unknown }).day;
  if (day === undefined) return 'today';
  return day === 'today' || day === 'yesterday' ? day : null;
}

function briefing(deps: DayToolDeps, day: 'today' | 'yesterday', turnId: string): string {
  const now = deps.now();
  // Local midnights, by calendar date, so a day the clocks change is 23 or 25 hours long.
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (day === 'yesterday') start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // Bounded at both ends in the query, so the rows of a later day never use up the limit.
  const sights = deps.sightLog.list(SIGHT_LIMIT, startIso, endIso);
  const rows = deps.activity.since(startIso, undefined, endIso);
  const label = day === 'today' ? 'Today' : 'Yesterday';

  const sections: string[] = [];
  const span = estimateSpan(sights.map((row) => row.at));
  if (span !== null) {
    sections.push(`Time: ${span} (an estimate: first to last look, breaks included).`);
  }
  sections.push(...section('What you were in', inApps(sights)));

  const asked = rows
    .filter((row) => row.kind === 'turn' && row.turnId !== turnId && row.text !== undefined)
    .map((row) => `${clock(row.startedAt)} "${clip(row.text ?? '')}"`);
  sections.push(...section('What you asked', asked));

  const experts = rows
    .filter((row) => row.kind === 'expert')
    .map((row) => {
      const files = row.changedFiles?.length ?? 0;
      const changed = files > 0 ? `, ${files} file${files === 1 ? '' : 's'} changed` : '';
      return `${row.expertName ?? 'An expert'}: "${askOf(row.text)}" (${row.state}${changed})`;
    });
  sections.push(...section('Experts', experts));
  sections.push(
    ...section(
      'Routines',
      rows
        .filter((row) => row.kind === 'routine')
        .map((r) => `${clip(r.text ?? 'A routine')} (${r.state})`),
    ),
  );
  sections.push(...section('Apps Scout called', appCalls(rows)));

  const open: string[] = [];
  for (const project of deps.pickUp?.get()?.projects ?? []) {
    open.push(`${project.name}${project.branch === undefined ? '' : ` on ${project.branch}`}`);
  }
  for (const pending of deps.handoffs.pending()) {
    open.push(`Waiting for Send: ${pending.expertName} "${clip(pending.ask)}"`);
  }
  for (const row of rows) {
    if (row.kind !== 'expert' || (row.state !== 'stopped' && row.state !== 'error')) continue;
    open.push(`Stopped or failed: ${row.expertName ?? 'An expert'} "${askOf(row.text)}"`);
  }
  sections.push(...section('Still open', open));

  const header =
    `${label}, from what Scout looked at or was asked. Scout only knows what it looked at ` +
    'or was asked, nothing else.';
  if (sights.length === 0 && rows.length === 0 && open.length === 0) {
    return `Nothing on record for ${day}: Scout did not look at anything and was not asked anything.`;
  }
  return cap([header, ...sections].join('\n'));
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, ...lines.map((line) => `- ${line}`)];
}

/** Looks grouped by app and title, most first. A blind spot shows as its app alone. */
function inApps(sights: readonly SightLogEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const row of sights) {
    if (row.app === undefined) continue;
    const key = row.title === undefined ? row.app : `${row.app}: ${row.title}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted
    .slice(0, MAX_GROUPS)
    .map(([key, count]) => `${clip(key)} (${count} look${count === 1 ? '' : 's'})`);
  if (sorted.length > MAX_GROUPS) lines.push(`and ${sorted.length - MAX_GROUPS} more`);
  return lines;
}

function appCalls(rows: readonly ActivityEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'connector') continue;
    const key = `${row.app ?? 'an app'} ${row.tool ?? ''} (${row.access ?? 'read'})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => (count === 1 ? key : `${key} x${count}`));
}

/** The ask, the first part of a brief: the selection and window it carried stay out. */
function askOf(text: string | undefined): string {
  return clip((text ?? '').split('\n\n')[0] ?? '');
}

/** Flattened, its secrets hidden, then cut to a line. */
function clip(text: string): string {
  const flat = hideSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length <= LINE_CHARS ? flat : `${flat.slice(0, LINE_CHARS - 1)}…`;
}

function clock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

function cap(text: string): string {
  if (text.length <= DAY_CHARS) return text;
  const note = '\n(cut short)';
  return `${text.slice(0, DAY_CHARS - note.length)}${note}`;
}
