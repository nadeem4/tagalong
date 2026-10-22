/**
 * The Self: Scout's own notes, as Home's What Scout learned shows them. Contains SelfPage,
 * SelfVersion, SelfNight and the `self.list`, `self.get`, `self.write`, `self.undo`,
 * `self.accept` and `self.reject` params and results.
 */
import { z } from 'zod';

export const SelfPage = z.object({
  /** `you.md`, `lessons.md`, `commitments.md` or `skills/<name>.md`. */
  path: z.string().min(1),
  chars: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().optional(),
  /** Proposed changes waiting on the person. */
  proposals: z.number().int().nonnegative(),
});
export type SelfPage = z.infer<typeof SelfPage>;

/** Who changed a page: the person (in Home or by hand), Scout during a turn, or sleep. */
export const SelfAuthor = z.enum(['person', 'scout', 'sleep']);
export type SelfAuthor = z.infer<typeof SelfAuthor>;

/**
 * `applied`: it was the page's text. `proposed`: a change waiting on the person, not applied.
 * `accepted`: a proposal they took, applied as a new version. `rejected`: one they turned down.
 */
export const SelfVersionState = z.enum(['applied', 'proposed', 'accepted', 'rejected']);
export type SelfVersionState = z.infer<typeof SelfVersionState>;

export const SelfVersion = z.object({
  id: z.number().int().positive(),
  path: z.string().min(1),
  author: SelfAuthor,
  why: z.string(),
  /** The turn a change made during a turn came from. */
  ref: z.string().min(1).optional(),
  state: SelfVersionState,
  /** On the version an accepted proposal became. */
  acceptedBy: z.literal('person').optional(),
  /** The page's whole text in this version, or the proposed text. */
  text: z.string(),
  chars: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type SelfVersion = z.infer<typeof SelfVersion>;

/** One night's sleep: how it went, and what it changed. */
export const SelfNight = z.object({
  state: z.enum(['running', 'done', 'error']),
  startedAt: z.iso.datetime(),
  note: z.string().optional(),
});
export type SelfNight = z.infer<typeof SelfNight>;

export const SelfListParams = z.object({});
export const SelfListResult = z.object({
  pages: z.array(SelfPage),
  /** The latest nights, newest first. */
  nights: z.array(SelfNight),
});
export type SelfListParams = z.infer<typeof SelfListParams>;
export type SelfListResult = z.infer<typeof SelfListResult>;

export const SelfGetParams = z.object({ path: z.string().min(1) });
/** Null for a path that is not a page. */
export const SelfGetResult = z
  .object({ path: z.string().min(1), text: z.string(), versions: z.array(SelfVersion) })
  .nullable();
export type SelfGetParams = z.infer<typeof SelfGetParams>;
export type SelfGetResult = z.infer<typeof SelfGetResult>;

/** The person's own edit, from Home: the whole page. */
export const SelfWriteParams = z.object({ path: z.string().min(1), text: z.string() });
export const SelfWriteResult = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  /** Saved, but cut to fit the page. */
  note: z.string().optional(),
});
export type SelfWriteParams = z.infer<typeof SelfWriteParams>;
export type SelfWriteResult = z.infer<typeof SelfWriteResult>;

/** Puts back what a page held before this change, as a new change of the person's. */
export const SelfUndoParams = z.object({ versionId: z.number().int().positive() });
export const SelfUndoResult = z.object({ ok: z.boolean(), reason: z.string().optional() });
export type SelfUndoParams = z.infer<typeof SelfUndoParams>;
export type SelfUndoResult = z.infer<typeof SelfUndoResult>;

/** Applies a proposed change, as a new version accepted by the person. */
export const SelfAcceptParams = z.object({ versionId: z.number().int().positive() });
export const SelfAcceptResult = z.object({ ok: z.boolean(), reason: z.string().optional() });
export type SelfAcceptParams = z.infer<typeof SelfAcceptParams>;
export type SelfAcceptResult = z.infer<typeof SelfAcceptResult>;

/** Turns a proposed change down: kept as rejected, never applied. */
export const SelfRejectParams = z.object({ versionId: z.number().int().positive() });
export const SelfRejectResult = z.object({ ok: z.boolean(), reason: z.string().optional() });
export type SelfRejectParams = z.infer<typeof SelfRejectParams>;
export type SelfRejectResult = z.infer<typeof SelfRejectResult>;
