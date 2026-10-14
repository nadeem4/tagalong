import type { Database } from 'better-sqlite3';
import { Connection } from '@tagalong/protocol';

/**
 * The person's connections, one JSON row each in the `connections` table (migration 12).
 * Definitions only: tokens and keys are in the host's secret store, never here.
 */
export class ConnectionStore {
  constructor(private readonly db: Database) {}

  list(): Connection[] {
    return this.db
      .prepare<[], { json: string }>('SELECT json FROM connections ORDER BY rowid')
      .all()
      .map((row) => Connection.parse(JSON.parse(row.json)));
  }

  get(id: string): Connection | null {
    const row = this.db
      .prepare<[string], { json: string }>('SELECT json FROM connections WHERE id = ?')
      .get(id);
    return row === undefined ? null : Connection.parse(JSON.parse(row.json));
  }

  upsert(connection: Connection): Connection {
    const parsed = Connection.parse(connection);
    this.db
      .prepare(
        `INSERT INTO connections (id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(parsed.id, JSON.stringify(parsed), new Date().toISOString());
    return parsed;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM connections WHERE id = ?').run(id).changes > 0;
  }
}
