/**
 * What the Tasks page reads of the brain's task list: one row per task that is not an Ask, with
 * its source and the chain of events that led to it. A malformed row is dropped, not fatal.
 * Contains parseTasksList and TaskRow, shaped after tasks_list (brain/src/brain/tasks_tools.py).
 */
import { z } from 'zod';

const Row = z
  .object({
    id: z.string().min(1),
    kind: z.string(),
    state: z.string(),
    title: z.string().nullable(),
    source: z.string(),
    chain: z.array(z.object({ kind: z.string(), source: z.string() })),
    created_at: z.string(),
    ended_at: z.string().nullable(),
  })
  .transform(({ created_at, ended_at, ...rest }) => ({
    ...rest,
    createdAt: created_at,
    endedAt: ended_at,
  }));

export type TaskRow = z.infer<typeof Row>;

export function parseTasksList(json: unknown): TaskRow[] {
  const { tasks } = z.object({ tasks: z.array(z.unknown()) }).parse(json);
  return tasks.flatMap((raw) => {
    const row = Row.safeParse(raw);
    return row.success ? [row.data] : [];
  });
}
