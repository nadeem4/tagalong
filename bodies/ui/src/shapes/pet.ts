/**
 * A pet: the on-screen companion, Scout, as the body draws it (id, name, avatar). Which
 * brain answers is the brain's business, not the pet's. Contains Pet.
 */
import { z } from 'zod';

/** One pet. */
export const Pet = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Emoji or an asset key the host knows how to render. */
  avatar: z.string().min(1),
});
export type Pet = z.infer<typeof Pet>;
