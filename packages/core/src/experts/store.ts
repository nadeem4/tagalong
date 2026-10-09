import type { Database } from 'better-sqlite3';
import { Expert } from '@tagalong/protocol';

/**
 * The experts the user has set up, one JSON row each in the `experts` table (migration 8).
 * Nothing secret is stored: a Claude Code expert is a folder and a command, and keys for
 * later connectors go to the host's keychain.
 */
export class ExpertStore {
  constructor(private readonly db: Database) {}

  /** In the order they were added; an edit keeps an expert's place. */
  list(): Expert[] {
    return this.db
      .prepare<[], { json: string }>('SELECT json FROM experts ORDER BY rowid')
      .all()
      .map((row) => Expert.parse(JSON.parse(row.json)));
  }

  get(id: string): Expert | null {
    const row = this.db
      .prepare<[string], { json: string }>('SELECT json FROM experts WHERE id = ?')
      .get(id);
    return row === undefined ? null : Expert.parse(JSON.parse(row.json));
  }

  upsert(expert: Expert): Expert {
    const parsed = Expert.parse(expert);
    this.db
      .prepare(
        `INSERT INTO experts (id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(parsed.id, JSON.stringify(parsed), new Date().toISOString());
    return parsed;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM experts WHERE id = ?').run(id).changes > 0;
  }
}
