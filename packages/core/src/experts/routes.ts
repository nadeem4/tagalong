import type { Database } from 'better-sqlite3';

export type RoutedBy = 'companion' | 'user';

export interface Route {
  expertId: string;
  by: RoutedBy;
}

/**
 * Which expert takes which kind of task, remembered across sessions in `expert_routes`
 * (migration 9). The companion records its own picks so it routes the same way next time;
 * a pick the user made always wins and the companion never overwrites it.
 */
export class RouteMemory {
  constructor(private readonly db: Database) {}

  get(taskKind: string): Route | null {
    const row = this.db
      .prepare<[string], { expert_id: string; chosen_by: RoutedBy }>(
        'SELECT expert_id, chosen_by FROM expert_routes WHERE task_kind = ?',
      )
      .get(normalise(taskKind));
    return row === undefined ? null : { expertId: row.expert_id, by: row.chosen_by };
  }

  remember(taskKind: string, expertId: string, by: RoutedBy): void {
    this.db
      .prepare(
        `INSERT INTO expert_routes (task_kind, expert_id, chosen_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(task_kind) DO UPDATE SET expert_id = excluded.expert_id,
           chosen_by = excluded.chosen_by, updated_at = excluded.updated_at
         WHERE expert_routes.chosen_by = 'companion' OR excluded.chosen_by = 'user'`,
      )
      .run(normalise(taskKind), expertId, by, new Date().toISOString());
  }

  /** Called when an expert is deleted, so no route points at it. */
  forgetExpert(expertId: string): void {
    this.db.prepare('DELETE FROM expert_routes WHERE expert_id = ?').run(expertId);
  }
}

function normalise(taskKind: string): string {
  return taskKind.trim().toLowerCase();
}
