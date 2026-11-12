/**
 * What Scout remembers: Home's list of Scout's long-term memories (facts, preferences and
 * conversation summaries), each deletable. A fact read from the person's profiles also says
 * where it came from. Contains MemoryEntry.
 */
import { z } from 'zod';

export const MemoryEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(['fact', 'preference', 'summary']),
  text: z.string(),
  createdAt: z.iso.datetime(),
  /** Profile facts only: work, skills, projects, interests, personal. */
  tag: z.string().optional(),
  /** Where it came from: chat, github, linkedin, web. */
  source: z.string().optional(),
  sourceRef: z.string().optional(),
  /** The words from the source that back the fact. */
  evidence: z.string().optional(),
  /** `asked` facts are used only when the person asks for them. */
  visibility: z.enum(['free', 'asked']).optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;
