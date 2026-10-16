/**
 * The Activity log: what Scout did, as Home's Activity view lists it. One entry per turn,
 * per brief handed to an expert, per call to a connected app and per routine run.
 * Contains ActivityEntry and the `activity.list` params and result.
 */
import { z } from 'zod';

/**
 * What an entry records: a turn, a hand-off to an expert, a connected-app call (`connector`)
 * or a routine run.
 */
export const ActivityKind = z.enum(['turn', 'expert', 'connector', 'routine']);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityState = z.enum(['running', 'done', 'error', 'stopped']);
export type ActivityState = z.infer<typeof ActivityState>;

export const ActivityEntry = z.object({
  id: z.string().min(1),
  kind: ActivityKind,
  state: ActivityState,
  /** Who acted: the pet answering a turn, or handing off. */
  petId: z.string().min(1),
  turnId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** A turn's question, a hand-off's brief. */
  text: z.string().optional(),
  /** A turn's or an expert's answer. */
  answer: z.string().optional(),
  /** An `expert` entry: the expert, and its name when the brief went, so a rename or a
   * deletion later does not rewrite the log. */
  expertId: z.string().min(1).optional(),
  expertName: z.string().min(1).optional(),
  /** An `expert` entry: the files the expert edited. */
  changedFiles: z.array(z.string()).optional(),
  /**
   * A `connector` entry: the app, the tool, and whether it only read. What went in and
   * what came back are never kept. `stopped` means the person cancelled a change.
   */
  app: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  access: z.enum(['read', 'write']).optional(),
  /** A `routine` entry: the routine that ran. Its name, as it was then, is `text`. */
  routineId: z.string().min(1).optional(),
  /** Why it failed, when `state` is `error`. */
  error: z.string().optional(),
  modelCalls: z.number().int().nonnegative().optional(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** Newest first. `before` is the `next` of the previous page. */
export const ActivityListParams = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(30),
});
export const ActivityListResult = z.object({
  entries: z.array(ActivityEntry),
  /** Present when older entries remain. */
  next: z.string().min(1).optional(),
});
export type ActivityListParams = z.input<typeof ActivityListParams>;
export type ActivityListResult = z.infer<typeof ActivityListResult>;
