/**
 * What a remote brain waits on from this PC, and what this PC already lets it run, as the UI
 * shows them. The desktop builds both from this PC's own facts, never from the brain's words.
 * Contains NeedsYouItem and ApprovedItem.
 */
import { z } from 'zod';

/** One request in Home's "Needs you on this PC"; `bubble` is false once the person said not now. */
export const NeedsYouItem = z.object({
  id: z.string(),
  need: z.enum(['approve', 'signin']),
  /** The brain that is asking, from the pairing. */
  brain: z.string(),
  /** The brain's certificate as a short code, so two brains of one name differ. */
  identity: z.string().optional(),
  /** The program or address in question, as the person reads it. */
  what: z.string(),
  /** Where the program is on this PC, or null when it is not there (an install) or is an address. */
  path: z.string().nullable(),
  expert: z.string().optional(),
  state: z.enum(['waiting', 'working', 'failed']),
  failure: z.string().optional(),
  bubble: z.boolean(),
});
export type NeedsYouItem = z.infer<typeof NeedsYouItem>;

/** One line of "Approved on this PC": what the brain may run here, and the key that revokes it. */
export const ApprovedItem = z.object({
  key: z.string(),
  what: z.string(),
  path: z.string().optional(),
  at: z.string().optional(),
});
export type ApprovedItem = z.infer<typeof ApprovedItem>;
