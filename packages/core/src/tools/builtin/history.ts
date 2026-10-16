/**
 * Searchable work memory: "what was that article about vector databases I read Tuesday?"
 * One read over the local index of window titles Scout looked at and the activity record.
 * Titles only: no page text was ever kept.
 * Contains `searchHistoryTool`.
 */
import type { HistoryHit, HistorySearchParams } from '../../memory/history-search';
import type { BrainTool } from '../../providers';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const SEARCH_HISTORY = 'search_history';

export interface HistoryToolDeps {
  history: { search(params: HistorySearchParams): HistoryHit[] };
}

const DEFINITION: BrainTool = {
  name: SEARCH_HISTORY,
  description:
    'Search what the person did on this computer: the window titles you looked at (with the ' +
    'app), their questions to you, briefs sent to experts and routine runs. Newest first, at ' +
    'most 20. Use it for "what was that article I read Tuesday?" or "when did I work on X?". ' +
    'It only knows window titles and asks, never page text, and nothing older than the ' +
    'privacy log keeps; say so when it matters.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to look for, e.g. "vector databases".' },
      since: {
        type: 'string',
        description: 'Optional ISO date or time; only things at or after it, e.g. "2026-10-13".',
      },
    },
    required: ['query'],
  },
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function searchHistoryTool(deps: HistoryToolDeps): Tool {
  return defineTool(DEFINITION, 'read', (input, ctx) => {
    const params = paramsOf(input);
    if (typeof params === 'string') return done({ content: params, isError: true });
    try {
      const hits = deps.history.search({ ...params, excludeTurnId: ctx.turnId });
      if (hits.length === 0) {
        return done({ content: `Nothing on record matches "${params.query}".` });
      }
      const lines = hits.map(line);
      return done({
        content: `${lines.join('\n')}\n(Window titles and asks only; no page text was kept.)`,
      });
    } catch {
      return done({ content: 'Tagalong could not search its records just now.', isError: true });
    }
  });
}

function done(outcome: ToolOutcome): Promise<ToolOutcome> {
  return Promise.resolve(outcome);
}

/** The validated input, or what is wrong with it. */
function paramsOf(input: unknown): { query: string; since?: string } | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return 'search_history needs { query }.';
  }
  const { query, since } = input as { query?: unknown; since?: unknown };
  if (typeof query !== 'string' || query.trim() === '') return 'query must be some words.';
  if (since === undefined) return { query };
  if (typeof since !== 'string') return 'since must be an ISO date or time.';
  const date = DATE_ONLY.exec(since);
  // A bare date means that day's local midnight, not UTC's.
  const at = date
    ? new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]))
    : new Date(since);
  if (Number.isNaN(at.getTime())) return 'since must be an ISO date or time.';
  return { query, since: at.toISOString() };
}

function line(hit: HistoryHit): string {
  const at = new Date(hit.at);
  const when = `${at.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`.replace(/,/g, '');
  const where = hit.app === undefined ? '' : ` in ${hit.app}`;
  const what = hit.text === undefined ? ' (no title kept)' : `: "${hit.text}"`;
  return `${when} ${hit.kind}${where}${what}`;
}
