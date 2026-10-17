/**
 * Searchable work memory: "what was that article about vector databases I read Tuesday?"
 * and "what did we do today?". One read over the local index of window titles Scout looked
 * at and the activity record: with a query, the matching rows; without one, every row in a
 * time range. Titles only: no page text was ever kept, and no answer is passed on.
 * Contains `searchHistoryTool`.
 */
import type { ActivityEntry, SightLogEntry } from '@tagalong/protocol';
import type { HistoryHit, HistorySearchParams } from '../../memory/history-search';
import { hideSecrets } from '../../privacy/secrets';
import type { BrainTool } from '../../providers';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const SEARCH_HISTORY = 'search_history';

/** The most rows a range listing hands back. */
const RANGE_ROWS = 60;
/** At most this many looks and activity rows are read for one range. */
const READ_LIMIT = 1_000;
/** A question or a brief is clipped to this. */
const LINE_CHARS = 120;
/** The sight-log kinds that are looks; a brief sent or a settings card applied is not. */
const LOOKS: ReadonlySet<SightLogEntry['kind']> = new Set([
  'listed_windows',
  'read_text',
  'screenshot',
  'read_element_names',
]);

export interface HistoryToolDeps {
  history: { search(params: HistorySearchParams): HistoryHit[] };
  /** Oldest first, rows at or after `startIso` and before `untilIso`. */
  activity: { since(startIso: string, limit?: number, untilIso?: string): ActivityEntry[] };
  /** Newest first, rows at or after `since` and before `until`. */
  sightLog: { list(limit?: number, since?: string, until?: string): SightLogEntry[] };
  /** How many days the privacy log keeps: a range never reaches further back. */
  days: () => number;
  now?: () => Date;
}

const DEFINITION: BrainTool = {
  name: SEARCH_HISTORY,
  description:
    'Search what the person did on this computer: the window titles you looked at (with the ' +
    'app), their questions to you, briefs sent to experts, routine runs and app calls. With ' +
    'a query, the matches, newest first, at most 20: "what was that article I read ' +
    'Tuesday?". Without one, everything between since and until, newest first: "what did ' +
    'we do today?". It keeps titles and asks only, never page text, and nothing older than ' +
    'the privacy log keeps.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional words to look for, e.g. "vector databases".',
      },
      since: {
        type: 'string',
        description: 'Optional ISO date or time, e.g. "2026-10-13". Without a query: today.',
      },
      until: {
        type: 'string',
        description: 'Optional ISO date or time; only things before it. Defaults to now.',
      },
    },
  },
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Params {
  query?: string;
  since?: string;
  until?: string;
}

export function searchHistoryTool(deps: HistoryToolDeps): Tool {
  return defineTool(DEFINITION, 'read', (input, ctx) => {
    const params = paramsOf(input);
    if (typeof params === 'string') return done({ content: params, isError: true });
    try {
      if (params.query === undefined) return done({ content: range(deps, params, ctx.turnId) });
      const { query, since, until } = params;
      const hits = deps.history
        .search({ query, ...(since === undefined ? {} : { since }), excludeTurnId: ctx.turnId })
        .filter((hit) => until === undefined || hit.at < until);
      if (hits.length === 0) return done({ content: `Nothing on record matches "${query}".` });
      return done({ content: hits.map(line).join('\n') });
    } catch {
      return done({ content: 'Tagalong could not search its records just now.', isError: true });
    }
  });
}

function done(outcome: ToolOutcome): Promise<ToolOutcome> {
  return Promise.resolve(outcome);
}

/** The validated input, or what is wrong with it. */
function paramsOf(input: unknown): Params | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return 'search_history takes { query?, since?, until? }.';
  }
  const { query, since, until } = input as Record<string, unknown>;
  const params: Params = {};
  if (query !== undefined) {
    if (typeof query !== 'string' || query.trim() === '') return 'query must be some words.';
    params.query = query;
  }
  for (const [key, value] of [
    ['since', since],
    ['until', until],
  ] as const) {
    if (value === undefined) continue;
    const at = typeof value === 'string' ? isoOf(value) : null;
    if (at === null) return `${key} must be an ISO date or time.`;
    params[key] = at;
  }
  return params;
}

/** A bare date means that day's local midnight, not UTC's. */
function isoOf(value: string): string | null {
  const date = DATE_ONLY.exec(value);
  const at = date
    ? new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]))
    : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The longest a day lasts, for the privacy log's cutoff. */
const DAY_MS = 86_400_000;

/**
 * Every row between since (default: local midnight today) and until (default: now). An
 * earlier since is raised to the privacy log's cutoff: the activity record is kept longer.
 */
function range(deps: HistoryToolDeps, params: Params, turnId: string): string {
  const now = deps.now?.() ?? new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const cutoff = new Date(now.getTime() - deps.days() * DAY_MS).toISOString();
  const asked = params.since ?? midnight.toISOString();
  const since = asked > cutoff ? asked : cutoff;
  const until = params.until ?? now.toISOString();
  if (since >= until) return `Nothing on record between ${asked} and ${until}.`;

  const rows: { at: string; text: string }[] = [];
  for (const row of deps.activity.since(since, READ_LIMIT, until)) {
    const text = activityLine(row, turnId);
    if (text !== null) rows.push({ at: row.startedAt, text });
  }
  rows.push(...looks(deps.sightLog.list(READ_LIMIT, since, until)));
  if (rows.length === 0) return `Nothing on record between ${since} and ${until}.`;

  rows.sort((a, b) => b.at.localeCompare(a.at));
  const shown = rows.slice(0, RANGE_ROWS).map((row) => row.text);
  if (rows.length > RANGE_ROWS) shown.push(`and ${rows.length - RANGE_ROWS} more.`);
  return shown.join('\n');
}

function activityLine(row: ActivityEntry, turnId: string): string | null {
  const when = stamp(row.startedAt);
  switch (row.kind) {
    case 'turn':
      if (row.turnId === turnId || row.text === undefined) return null;
      return `${when} asked: "${clip(row.text)}"`;
    case 'expert': {
      const files = row.changedFiles?.length ?? 0;
      const changed = files > 0 ? `, ${files} file${files === 1 ? '' : 's'} changed` : '';
      // The ask only: the selection and window a brief carried stay out.
      const ask = clip((row.text ?? '').split('\n\n')[0] ?? '');
      return `${when} expert ${row.expertName ?? 'an expert'}: "${ask}" (${row.state}${changed})`;
    }
    case 'routine':
      return `${when} routine: "${clip(row.text ?? 'a routine')}" (${row.state})`;
    case 'connector':
      return `${when} app ${row.app ?? 'an app'} ${row.tool ?? ''} (${row.access ?? 'read'})`;
  }
}

/** Looks grouped by app and title, with the first and last time. A blind spot shows its app alone. */
function looks(sights: readonly SightLogEntry[]): { at: string; text: string }[] {
  const groups = new Map<
    string,
    { app: string; title?: string; first: string; last: string; n: number }
  >();
  for (const row of sights) {
    if (row.app === undefined || !LOOKS.has(row.kind)) continue;
    const key = `${row.app}\u0000${row.title ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        app: row.app,
        ...(row.title === undefined ? {} : { title: row.title }),
        first: row.at,
        last: row.at,
        n: 1,
      });
      continue;
    }
    if (row.at < group.first) group.first = row.at;
    if (row.at > group.last) group.last = row.at;
    group.n += 1;
  }
  return [...groups.values()].map((g) => {
    const sameDay = day(g.first) === day(g.last);
    const until = g.first === g.last ? '' : sameDay ? `-${clock(g.last)}` : ` to ${stamp(g.last)}`;
    const count = `${g.n} look${g.n === 1 ? '' : 's'}`;
    const what =
      g.title === undefined ? ` (no title kept, ${count})` : `: "${clip(g.title)}" (${count})`;
    return { at: g.last, text: `${stamp(g.first)}${until} saw in ${g.app}${what}` };
  });
}

function line(hit: HistoryHit): string {
  const where = hit.app === undefined ? '' : ` in ${hit.app}`;
  const what = hit.text === undefined ? ' (no title kept)' : `: "${hit.text}"`;
  return `${stamp(hit.at)} ${hit.kind}${where}${what}`;
}

/** "Tue 13 Oct 14:05", local time. */
function stamp(iso: string): string {
  return `${day(iso)} ${clock(iso)}`;
}

function day(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '');
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Flattened, its secrets hidden, then cut to a line. */
function clip(text: string): string {
  const flat = hideSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length <= LINE_CHARS ? flat : `${flat.slice(0, LINE_CHARS - 1)}…`;
}
