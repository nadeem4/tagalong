import type { Database } from 'better-sqlite3';
import type { PickUpEditor, PickUpHandoff } from '@tagalong/protocol';

/** A project as the snapshot keeps it: names and a path from a window title, never a file read. */
export interface SnapshotProject {
  name: string;
  path: string;
  editor: PickUpEditor;
  branch?: string;
  file?: string;
}

/** A hand-off left half done, with the expert it was for, so Brief again can propose it. */
export interface SnapshotHandoff {
  expertId: string;
  expertName: string;
  ask: string;
  state: PickUpHandoff['state'];
}

/**
 * What you were last in the middle of. `startedAt` is when this snapshot began (the last
 * time one was offered, or the first ever); `takenAt` is its latest overwrite, so a gap
 * since then is time away.
 */
export interface PickUpSnapshot {
  startedAt: number;
  takenAt: number;
  projects: SnapshotProject[];
  handoffs: SnapshotHandoff[];
}

/** The one pick-up row (migration 16). Overwritten, never added to. */
export class PickUpStore {
  constructor(private readonly db: Database) {}

  get(): PickUpSnapshot | null {
    const row = this.db
      .prepare<[], { started_at: string; taken_at: string; json: string }>(
        'SELECT started_at, taken_at, json FROM pick_up WHERE id = 1',
      )
      .get();
    if (row === undefined) return null;
    try {
      const startedAt = Date.parse(row.started_at);
      const takenAt = Date.parse(row.taken_at);
      if (Number.isNaN(startedAt) || Number.isNaN(takenAt)) return null;
      const body = JSON.parse(row.json) as Pick<PickUpSnapshot, 'projects' | 'handoffs'>;
      return { startedAt, takenAt, projects: body.projects ?? [], handoffs: body.handoffs ?? [] };
    } catch {
      return null;
    }
  }

  save(snapshot: PickUpSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO pick_up (id, started_at, taken_at, json) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           started_at = excluded.started_at, taken_at = excluded.taken_at, json = excluded.json`,
      )
      .run(
        new Date(snapshot.startedAt).toISOString(),
        new Date(snapshot.takenAt).toISOString(),
        JSON.stringify({ projects: snapshot.projects, handoffs: snapshot.handoffs }),
      );
  }

  clear(): void {
    this.db.prepare('DELETE FROM pick_up').run();
  }
}
