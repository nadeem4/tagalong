/**
 * Searchable work memory: full-text search over the window titles Scout looked at and the
 * activity asks (HistorySearch, historyQuery). Used by the search_history tool.
 */
import type Database from 'better-sqlite3';
import { hideSecrets } from '../privacy/secrets';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most hits one search hands back. */
export const HISTORY_HITS = 20;
/** A returned line is clipped to this. */
const TEXT_CHARS = 160;
const MAX_QUERY_WORDS = 16;

/** One thing found: a window Scout looked at, or an ask, brief or routine run. */
export interface HistoryHit {
  at: string;
  /** `saw` for a look; otherwise the activity's kind (`asked` for a question). */
  kind: string;
  /** The app of a look, or the expert of a brief. */
  app?: string;
  /** Absent for a look whose title was never kept (a blind spot). */
  text?: string;
}

export interface HistorySearchParams {
  query: string;
  /** ISO time: only rows at or after it. Never earlier than the days the log keeps. */
  since?: string | undefined;
  /** The asking turn, so its own question is not found. */
  excludeTurnId?: string | undefined;
}

export interface HistorySearchOptions {
  /** The privacy log's retention, read on every search. */
  days: () => number;
  now?: () => Date;
}

/**
 * Turns free text into an FTS5 query that can neither fail to parse nor inject syntax:
 * each distinct word is quoted, so a quote, `*`, `NEAR(`, `OR` or `column:` is just text.
 * The words are AND-ed (FTS5's default between phrases), so every word must match.
 * One-letter words are dropped. Returns null when no word survives.
 */
export function historyQuery(text: string): string | null {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match[0].length < 2) continue;
    words.add(match[0]);
    if (words.size >= MAX_QUERY_WORDS) break;
  }
  return words.size === 0 ? null : [...words].map((word) => `"${word}"`).join(' ');
}

interface SightHit {
  at: string;
  app: string | null;
  title: string | null;
}

interface ActivityHit {
  started_at: string;
  kind: string;
  text: string | null;
  expert_name: string | null;
}

/**
 * Searchable work memory (migration 18): the window titles Scout looked at and the
 * activity text, through FTS5 indexes the triggers keep in step. Read-only. A row the
 * person deleted, or the retention pruned, has already left the index; the retention is
 * also applied here, so nothing older than the log keeps is found in either record.
 */
export class HistorySearch {
  readonly #now: () => Date;

  constructor(
    private readonly db: Database.Database,
    private readonly options: HistorySearchOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  /** Newest first, at most `HISTORY_HITS`. A title seen many times counts once. */
  search(params: HistorySearchParams): HistoryHit[] {
    const match = historyQuery(params.query);
    if (match === null) return [];
    const cutoff = new Date(this.#now().getTime() - this.options.days() * DAY_MS).toISOString();
    const since = params.since !== undefined && params.since > cutoff ? params.since : cutoff;

    const sights = this.db
      .prepare<[string, string, number], SightHit>(
        `SELECT MAX(s.at) AS at, s.app, s.title FROM sight_log_fts f
           JOIN sight_log s ON s.rowid = f.rowid
         WHERE sight_log_fts MATCH ? AND s.at >= ?
         GROUP BY s.app, s.title ORDER BY at DESC LIMIT ?`,
      )
      .all(match, since, HISTORY_HITS)
      .map((row): HistoryHit => ({
        at: row.at,
        kind: 'saw',
        ...(row.app === null ? {} : { app: row.app }),
        ...(row.title === null ? {} : { text: clip(row.title) }),
      }));

    const activity = this.db
      .prepare<[string, string, string, number], ActivityHit>(
        `SELECT a.started_at, a.kind, a.text, a.expert_name FROM activity_fts f
           JOIN activity a ON a.rowid = f.rowid
         WHERE activity_fts MATCH ? AND a.started_at >= ?
           AND (a.turn_id IS NULL OR a.turn_id <> ?)
         ORDER BY a.started_at DESC LIMIT ?`,
      )
      .all(match, since, params.excludeTurnId ?? '', HISTORY_HITS)
      .map((row): HistoryHit => {
        // A brief shows its ask only (the first paragraph), never the window or selection.
        const text = row.kind === 'expert' ? (row.text ?? '').split(/\n\s*\n/)[0] : row.text;
        return {
          at: row.started_at,
          kind: row.kind === 'turn' ? 'asked' : row.kind,
          ...(row.expert_name === null ? {} : { app: row.expert_name }),
          ...(text === null || text === undefined ? {} : { text: clip(text) }),
        };
      });

    return [...sights, ...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_HITS);
  }
}

function clip(text: string): string {
  const clean = hideSecrets(text).replace(/\s+/g, ' ').trim();
  return clean.length > TEXT_CHARS ? `${clean.slice(0, TEXT_CHARS - 1)}…` : clean;
}
