import { z } from 'zod';

/**
 * What the crew did, as Home's activity view lists it: each turn, each consult (`ask_pet`),
 * each handoff (`@Name`), each roundtable (`/crew`), each brief a companion handed
 * to an expert, and each call to a connected app (`connector`). Meetings are not here: they do not
 * exist in the engine yet, and the view keeps their empty state instead.
 */
export const ActivityKind = z.enum([
  'turn',
  'consult',
  'handoff',
  'roundtable',
  'expert',
  'connector',
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityState = z.enum(['running', 'done', 'error', 'stopped']);
export type ActivityState = z.infer<typeof ActivityState>;

export const ActivityEntry = z.object({
  id: z.string().min(1),
  kind: ActivityKind,
  state: ActivityState,
  /** Who acted: the pet answering a turn, the asker of a consult, the pet handing off. */
  petId: z.string().min(1),
  /** The pet asked, or handed to. */
  toPetId: z.string().min(1).optional(),
  turnId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  /** Set on a roundtable and on each of its turns, so the run's turns can be read together. */
  runId: z.uuid().optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** A turn's question, a consult's question, a handoff's summary. */
  text: z.string().optional(),
  /** A turn's or a consult's answer. */
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
