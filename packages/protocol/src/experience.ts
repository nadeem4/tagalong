/**
 * The experience log: what the mind decided and what came of it. One episode per turn, job,
 * routine run or check-in, each with its steps (tool calls) and outcomes (Not now, an offer
 * taken, a hand-off sent). Contains Episode, EpisodeEvent and the `experience.list` and
 * `experience.get` params and results.
 */
import { z } from 'zod';

/** Which mind ran: a turn they asked for, a background job, a routine, or a check-in. */
export const EpisodeMode = z.enum(['turn', 'job', 'routine', 'check-in']);
export type EpisodeMode = z.infer<typeof EpisodeMode>;

/**
 * What the mind decided. A turn `answered` (or was `stopped`, or hit an `error`); a check-in
 * stayed `quiet`, `spoke`, `offered` work, or got `no-answer` from a brain that failed or
 * timed out. Absent while it is still running.
 */
export const EpisodeDecision = z.enum([
  'answered',
  'stopped',
  'error',
  'quiet',
  'spoke',
  'offered',
  'no-answer',
]);
export type EpisodeDecision = z.infer<typeof EpisodeDecision>;

export const Episode = z.object({
  id: z.string().min(1),
  mode: EpisodeMode,
  /** Why it woke: `asked`, `routine`, `job`, or a check-in's reason (`trouble`, `launch`…). */
  trigger: z.string().min(1),
  petId: z.string().min(1),
  /** The turn id, or a check-in remark's id, that outcomes are matched on. */
  ref: z.string().min(1).optional(),
  conversationId: z.uuid().optional(),
  model: z.string().min(1).optional(),
  /** What it was asked, or a check-in's whole bundle: secrets hidden, clipped. */
  input: z.string().optional(),
  decision: EpisodeDecision.optional(),
  /** What it said, if anything: secrets hidden, clipped. */
  said: z.string().optional(),
  /** A check-in's offer, the reason a turn stopped or failed. */
  note: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  modelCalls: z.number().int().nonnegative().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type Episode = z.infer<typeof Episode>;

/**
 * A `step` is a tool call: `name` is the tool, `input` what it was called with, `result` the
 * first line of what came back, `ok` false when it failed. An `outcome` is what the person did
 * about it afterwards: `name` is `not-now`, `accepted`, `sent`, `dismissed` and so on.
 */
export const EpisodeEvent = z.object({
  kind: z.enum(['step', 'outcome']),
  name: z.string().min(1),
  input: z.string().optional(),
  result: z.string().optional(),
  ok: z.boolean().optional(),
  at: z.iso.datetime(),
});
export type EpisodeEvent = z.infer<typeof EpisodeEvent>;

/** Newest first. `before` is the `next` of the previous page. */
export const ExperienceListParams = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(30),
});
export const ExperienceListResult = z.object({
  episodes: z.array(Episode),
  /** Present when older episodes remain. */
  next: z.string().min(1).optional(),
});
export type ExperienceListParams = z.input<typeof ExperienceListParams>;
export type ExperienceListResult = z.infer<typeof ExperienceListResult>;

export const ExperienceGetParams = z.object({ id: z.string().min(1) });
/** Null when the episode is gone: pruned, or never there. */
export const ExperienceGetResult = z
  .object({ episode: Episode, events: z.array(EpisodeEvent) })
  .nullable();
export type ExperienceGetParams = z.infer<typeof ExperienceGetParams>;
export type ExperienceGetResult = z.infer<typeof ExperienceGetResult>;
