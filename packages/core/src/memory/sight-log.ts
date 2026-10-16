/**
 * Home's "What Scout saw": the privacy log of every look and send, metadata only (SightLog,
 * table sight_log).
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { SightLogEntry } from '@tagalong/protocol';
import type { CaptureExclusions, SightKind } from '@tagalong/protocol';
import { findCaptureBlock } from '../perception/exclusions';
import { hideSecrets } from '../privacy/secrets';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One look or one send, as the wrappers report it. Counts and names, never content. */
export interface SightRow {
  kind: SightKind;
  app?: string | undefined;
  title?: string | undefined;
  providerId?: string | undefined;
  model?: string | undefined;
  expertName?: string | undefined;
  windows?: number | undefined;
  chars?: number | undefined;
  images?: number | undefined;
  source?: 'uia' | 'ocr' | undefined;
}

/** What the wrappers need: somewhere to write. */
export interface SightRecorder {
  record(row: SightRow): void;
}

export interface SightLogOptions {
  /** Read on every write, so a change in Settings applies to the next row. */
  days: () => number;
  /** The person's exclusions; the built-in blind spots are always checked as well. */
  exclusions: () => CaptureExclusions;
  now?: () => Date;
}

interface Row {
  id: string;
  kind: string;
  at: string;
  app: string | null;
  title: string | null;
  provider_id: string | null;
  model: string | null;
  expert_name: string | null;
  windows: number | null;
  chars: number | null;
  images: number | null;
  source: string | null;
}

/**
 * Home's "What Scout saw": the record of Scout's own looking (migration 15). Every row is
 * metadata. A title has its secrets hidden, and the title of a blind spot or an excluded
 * window is not kept at all, only its app. Rows older than `days` go on every write and at
 * boot. Separate from screen memory, which holds pictures in RAM and never on disk.
 */
export class SightLog implements SightRecorder {
  readonly #now: () => Date;

  constructor(
    private readonly db: Database.Database,
    private readonly options: SightLogOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  record(row: SightRow): void {
    this.prune();
    const title = this.#keptTitle(row.app, row.title);
    this.db
      .prepare(
        `INSERT INTO sight_log (id, kind, at, app, title, provider_id, model, expert_name,
           windows, chars, images, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        row.kind,
        this.#now().toISOString(),
        blankToNull(row.app),
        title,
        blankToNull(row.providerId),
        blankToNull(row.model),
        blankToNull(row.expertName),
        row.windows ?? null,
        row.chars ?? null,
        row.images ?? null,
        row.source ?? null,
      );
  }

  /**
   * Newest first; with `since` and `until`, only rows at or after `since` and before `until`
   * (the daily briefing's day). A row a later version wrote with an unknown kind is left out.
   */
  list(limit = 200, since = '', until = '9999'): SightLogEntry[] {
    return this.db
      .prepare<[string, string, number], Row>(
        'SELECT * FROM sight_log WHERE at >= ? AND at < ? ORDER BY at DESC, rowid DESC LIMIT ?',
      )
      .all(since, until, limit)
      .flatMap((row) => {
        const parsed = SightLogEntry.safeParse(toEntry(row));
        return parsed.success ? [parsed.data] : [];
      });
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM sight_log WHERE id = ?').run(id).changes > 0;
  }

  /** Delete all: the log only, never the conversations or what was already sent. */
  clear(): number {
    return this.db.prepare('DELETE FROM sight_log').run().changes;
  }

  /** Drops rows older than the days kept; returns how many went. */
  prune(): number {
    const cutoff = new Date(this.#now().getTime() - this.options.days() * DAY_MS).toISOString();
    return this.db.prepare('DELETE FROM sight_log WHERE at < ?').run(cutoff).changes;
  }

  #keptTitle(app: string | undefined, title: string | undefined): string | null {
    if (title === undefined || title.trim() === '') return null;
    const window = { ...(app === undefined ? {} : { processName: app }), title };
    if (findCaptureBlock(window, this.options.exclusions()) !== null) return null;
    return hideSecrets(title);
  }
}

function blankToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

function toEntry(row: Row): Record<string, unknown> {
  const entry: Record<string, unknown> = { id: row.id, kind: row.kind, at: row.at };
  const optional: [string, unknown][] = [
    ['app', row.app],
    ['title', row.title],
    ['providerId', row.provider_id],
    ['model', row.model],
    ['expertName', row.expert_name],
    ['windows', row.windows],
    ['chars', row.chars],
    ['images', row.images],
    ['source', row.source],
  ];
  for (const [key, value] of optional) if (value !== null) entry[key] = value;
  return entry;
}
