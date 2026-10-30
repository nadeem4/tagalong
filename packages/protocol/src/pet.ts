/**
 * A pet: the on-screen companion, Scout, as the body draws it (id, name, avatar). Which
 * brain answers is the brain's business, not the pet's. Contains Pet and SCOUT_ID.
 */
import { z } from 'zod';

/** Scout's id: the one pet there is. */
export const SCOUT_ID = 'scout';

/**
 * One pet. Parsing drops unknown keys, so a pet saved by an older version, with fields
 * since removed, still parses.
 */
export const Pet = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Emoji or an asset key the host knows how to render. */
  avatar: z.string().min(1),
});
export type Pet = z.infer<typeof Pet>;
