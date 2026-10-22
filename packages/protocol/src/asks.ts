/**
 * Asks: everything that waits on the person, saved. A change in a connected app (held by the
 * turn that asked) and a hand-off card (free: nothing waits on it). Contains the Ask schema,
 * its kinds, risks, states and notes, and the asks.* methods and notification.
 */
import { z } from 'zod';

export const AskKind = z.enum(['app-change', 'handoff']);
export type AskKind = z.infer<typeof AskKind>;

/** read never asks; high is a change that cannot be undone, shown as such. */
export const AskRisk = z.enum(['read', 'change', 'high']);
export type AskRisk = z.infer<typeof AskRisk>;

/** One outcome set for every ask. Only `approved` runs anything, and only a click sets it. */
export const AskState = z.enum(['waiting', 'approved', 'declined', 'expired', 'cancelled']);
export type AskState = z.infer<typeof AskState>;

/**
 * Why an ask ended without the person: the turn was stopped or replaced (`turn-ended`),
 * Tagalong closed while it waited (`closed`), the expert is gone (`expert-unavailable`), or
 * nobody answered in time (`expired`). A code; the UI says it in words.
 */
export const AskNote = z.enum(['turn-ended', 'closed', 'expert-unavailable', 'expired']);
export type AskNote = z.infer<typeof AskNote>;

export const Ask = z.object({
  id: z.uuid(),
  kind: AskKind,
  petId: z.string().min(1),
  /** What will happen, secrets hidden. Once answered, only its first line, clipped. */
  summary: z.string().min(1),
  risk: AskRisk,
  app: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  expertName: z.string().min(1).optional(),
  originTurnId: z.uuid().optional(),
  state: AskState,
  answeredBy: z.enum(['you', 'rule']).optional(),
  note: AskNote.optional(),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  answeredAt: z.string().min(1).optional(),
});
export type Ask = z.infer<typeof Ask>;

/** Home's Waiting on you: what waits, oldest first, and the last answered, newest first. */
export const AsksListParams = z.object({});
export const AsksListResult = z.object({ waiting: z.array(Ask), recent: z.array(Ask) });
export type AsksListResult = z.infer<typeof AsksListResult>;

/** A click on Allow once or Decline. A hand-off is sent from its card, never approved here. */
export const AsksAnswerParams = z.object({
  id: z.uuid(),
  decision: z.enum(['approve', 'decline']),
});
export const AsksAnswerResult = z.object({ accepted: z.boolean() });

/** Open: a hand-off's card comes up again in the bubble, for its folder and Send. */
export const AsksOpenParams = z.object({ id: z.uuid() });
export const AsksOpenResult = z.object({ opened: z.boolean() });

/** Every change to what waits, so the bubble and Home agree. */
export const AsksChangedParams = z.object({ waiting: z.array(Ask) });
export type AsksChangedParams = z.infer<typeof AsksChangedParams>;
