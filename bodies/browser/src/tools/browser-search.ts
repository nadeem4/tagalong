/**
 * The `browser_search` tool: look through history, bookmarks, the reading list, downloads or
 * recently closed tabs. Each source asks for its own optional permission first; results are
 * one short line per hit so a search never floods the turn.
 */
import type { SearchApi, SearchHit } from '../layer/api';
import type { OptionalPermission } from '../permissions';
import { failed, invalid, type BrowserTool } from './registry';
import type { Needs } from './tabs';

export interface BrowserSearchDeps {
  search: SearchApi;
  needs: Needs;
  bodyName: string;
}

type Source = 'history' | 'bookmarks' | 'reading_list' | 'downloads' | 'closed';

const SOURCES: Record<Source, { permission: OptionalPermission; reason: string }> = {
  history: { permission: 'history', reason: 'search your browsing history' },
  bookmarks: { permission: 'bookmarks', reason: 'search your bookmarks' },
  reading_list: { permission: 'readingList', reason: 'search your reading list' },
  downloads: { permission: 'downloads', reason: 'search your downloads' },
  closed: { permission: 'sessions', reason: 'see your recently closed tabs' },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_LINE = 300;

function limitOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

/** An ISO date or timestamp as milliseconds; absent stays undefined, junk is invalid. */
function dateOf(name: string, raw: unknown, endOfDay = false): number | undefined {
  if (raw === undefined) return undefined;
  const day = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  // A date with no time is the person's local day; Date.parse would read it as UTC.
  const ms = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + (endOfDay ? 1 : 0)).getTime()
    : typeof raw === 'string'
      ? Date.parse(raw)
      : Number.NaN;
  if (Number.isNaN(ms)) throw invalid(`${name} must be a date like 2026-10-29`);
  return ms;
}

function line(hit: SearchHit): string {
  return [hit.when, hit.title, hit.url]
    .filter((p) => p !== undefined && p !== '')
    .join(' | ')
    .slice(0, MAX_LINE);
}

export function browserSearchTool(deps: BrowserSearchDeps): BrowserTool {
  const { search, needs } = deps;
  return {
    tool: {
      name: 'browser_search',
      description:
        'Search the browser\'s own records: "history", "bookmarks", "reading_list", ' +
        '"downloads" or "closed" (recently closed tabs). Optional text to match, and since / ' +
        'until dates (like 2026-10-29; until includes that day) for history and downloads. Returns one line per hit. ' +
        `This is the ${deps.bodyName} browser.`,
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: Object.keys(SOURCES) },
          text: { type: 'string', description: 'Words to match. Default: everything.' },
          since: { type: 'string', description: 'Only after this date or time (ISO).' },
          until: { type: 'string', description: 'Only before this date or time (ISO).' },
          limit: {
            type: 'number',
            description: `Most hits to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
          },
        },
        required: ['source'],
      },
      effect: 'read',
    },
    async run(input) {
      const source = input['source'];
      if (typeof source !== 'string' || !Object.hasOwn(SOURCES, source)) {
        throw invalid(
          'source must be "history", "bookmarks", "reading_list", "downloads" or "closed"',
        );
      }
      const text = typeof input['text'] === 'string' ? input['text'] : '';
      const since = dateOf('since', input['since']);
      const until = dateOf('until', input['until'], true);
      const limit = limitOf(input['limit']);

      const { permission, reason } = SOURCES[source as Source];
      await needs.ensure({ kind: 'permission', name: permission }, reason);

      let hits: SearchHit[];
      try {
        switch (source as Source) {
          case 'history':
            hits = await search.history(text, since, until, limit);
            break;
          case 'bookmarks':
            hits = await search.bookmarks(text, limit);
            break;
          case 'reading_list':
            hits = await search.readingList(text, limit);
            break;
          case 'downloads':
            hits = await search.downloads(text, since, until, limit);
            break;
          case 'closed':
            hits = await search.closedTabs(limit);
            break;
        }
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        throw failed(`I could not search that: ${why}`);
      }
      return [
        { type: 'text', text: hits.length === 0 ? 'Nothing matched.' : hits.map(line).join('\n') },
      ];
    },
  };
}
