/**
 * Get to know me, as the UI sees it: the sources Scout can read, what the person hands over to
 * start a run, and the live status of the run. Mirrors contract v1's know_me frames. Contains
 * KnowSourceInfo, KnowMeInput and KnowMeStatus.
 */
import { z } from 'zod';

/** One source the brain can read, and what it needs from the person (nothing, a name, a file). */
export const KnowSourceInfo = z.object({
  name: z.string().min(1),
  needs: z.enum(['username', 'file', 'none']),
  label: z.string(),
});
export type KnowSourceInfo = z.infer<typeof KnowSourceInfo>;

/** What starts a run: a GitHub username, a LinkedIn PDF (base64), or both. */
export const KnowMeInput = z.object({
  github: z.string().optional(),
  pdf: z.object({ name: z.string(), data: z.string() }).optional(),
});
export type KnowMeInput = z.infer<typeof KnowMeInput>;

/**
 * The run so far. `sources` holds one row per source and a last row named `portrait` that
 * carries the portrait's own gap (nothing found, daily limit reached).
 */
export const KnowMeStatus = z.object({
  sources: z.array(
    z.object({
      name: z.string(),
      state: z.enum(['waiting', 'reading', 'done', 'failed']),
      gap: z.string().optional(),
    }),
  ),
  done: z.boolean(),
  portrait: z.string().optional(),
});
export type KnowMeStatus = z.infer<typeof KnowMeStatus>;
