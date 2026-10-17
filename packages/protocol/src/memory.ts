/**
 * What Scout remembers: Home's list of Scout's long-term memories (facts, preferences and
 * conversation summaries), each deletable. Contains MemoryEntry and the `memory.*` messages.
 */
import { z } from 'zod';

export const MemoryEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(['fact', 'preference', 'summary']),
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;

/** Newest first. `before` is the `next` of the previous page. */
export const MemoryListParams = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export const MemoryListResult = z.object({
  memories: z.array(MemoryEntry),
  /** Present when older memories remain. */
  next: z.string().min(1).optional(),
});
export const MemoryDeleteParams = z.object({ id: z.string().min(1) });
export const MemoryDeleteResult = z.object({ deleted: z.boolean() });
export type MemoryListParams = z.input<typeof MemoryListParams>;
export type MemoryListResult = z.infer<typeof MemoryListResult>;
