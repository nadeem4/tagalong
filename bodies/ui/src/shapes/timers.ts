/**
 * What the Timers tab reads of the brain's timers: one row per timer waiting to fire. Contains
 * parseTimersState and TimerRow, shaped after timers_state (brain/src/brain/timers_home.py).
 */
import { z } from 'zod';

const Wire = z.object({
  timers: z.array(
    z
      .object({
        id: z.string().min(1),
        note: z.string(),
        next_at: z.string(),
        repeat_minutes: z.number().nullable(),
        pending: z.boolean(),
      })
      .transform((t) => ({
        id: t.id,
        note: t.note,
        nextAt: t.next_at,
        repeatMinutes: t.repeat_minutes,
        pending: t.pending,
      })),
  ),
});

export type TimerRow = z.infer<typeof Wire>['timers'][number];

export function parseTimersState(json: unknown): TimerRow[] {
  return Wire.parse(json).timers;
}
