/**
 * What Connections reads of the brain's updates: one row per installed app and expert (the
 * version it runs, the newer one if any, how the update is going) and the per-group "keep up to
 * date automatically" switches. Contains parseUpdatesState, pendingUpdates and the UpdatesState
 * types, shaped after updates_state (brain/src/brain/setup/updates.py).
 */
import { z } from 'zod';

const Group = z.object({ official: z.boolean(), community: z.boolean() });

const Wire = z.object({
  checkedAt: z.string().nullable(),
  auto: z.object({ apps: Group, experts: Group }),
  items: z.array(
    z.object({
      kind: z.enum(['app', 'expert']),
      id: z.string().min(1),
      name: z.string(),
      installed: z.string(),
      // Only set when there is something newer.
      latest: z.string().nullable(),
      // A remote app is updated by its service: no version here, no controls.
      remote: z.boolean(),
      official: z.boolean(),
      auto: z.boolean(),
      status: z.enum(['idle', 'waiting', 'updating', 'updated', 'failed']),
      error: z.string().optional(),
    }),
  ),
});

export type UpdatesState = z.infer<typeof Wire>;
export type UpdateRow = UpdatesState['items'][number];
export type UpdateKind = UpdateRow['kind'];
/** What pressing Update answers: started, waiting for a running job, or a short error token. */
export interface UpdateResult {
  started?: boolean;
  waiting?: string;
  error?: string;
  count?: number;
}

export function parseUpdatesState(json: unknown): UpdatesState {
  return Wire.parse(json);
}

/** How many of a kind have an update the person could still press (the "Update all (n)"). */
export function pendingUpdates(state: UpdatesState, kind: UpdateKind): number {
  return state.items.filter(
    (row) => row.kind === kind && row.latest !== null && row.status === 'idle',
  ).length;
}
