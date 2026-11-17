/**
 * What the Waiting tab reads of the brain's events: one row per news event not yet told, or
 * given up on. Contains parseEventsWaiting and WaitingEvent, shaped after events_waiting
 * (brain/src/brain/events_tools.py).
 */
import { z } from 'zod';

const Wire = z.object({
  waiting: z.array(
    z
      .object({
        id: z.string().min(1),
        kind: z.string(),
        source: z.string(),
        at: z.string(),
        age_s: z.number(),
        gave_up: z.boolean(),
        gist: z.string(),
      })
      .transform(({ id, kind, source, age_s, gave_up, gist }) => ({
        id,
        kind,
        source,
        ageS: age_s,
        gaveUp: gave_up,
        gist,
      })),
  ),
});

export type WaitingEvent = z.infer<typeof Wire>['waiting'][number];

export function parseEventsWaiting(json: unknown): WaitingEvent[] {
  return Wire.parse(json).waiting;
}
