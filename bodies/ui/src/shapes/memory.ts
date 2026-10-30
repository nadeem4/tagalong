/**
 * What Scout remembers: Home's list of Scout's long-term memories (facts, preferences and
 * conversation summaries), each deletable. Contains MemoryEntry.
 */
import { z } from 'zod';

export const MemoryEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(['fact', 'preference', 'summary']),
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;
