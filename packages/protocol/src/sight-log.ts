import { z } from 'zod';

/**
 * What Scout saw: Home's record of each time Scout looked at the screen or sent something
 * off this computer. Metadata only — kind, app, title, destination, counts and time. Never
 * the pixels, the text or the brief.
 */

/**
 * Each kind of looking or sending. New kinds are appended (the database stores the kind as
 * plain text, with no constraint, so adding one needs no migration).
 */
export const SightKind = z.enum([
  'listed_windows',
  'read_text',
  'screenshot',
  'sent_to_ai',
  'sent_to_expert',
  /** Pointing at something: the host read a window's element names to find the one asked. */
  'read_element_names',
  /** Not a look: the person applied a settings card Scout showed. `title` names the settings. */
  'changed_by_talk',
]);
export type SightKind = z.infer<typeof SightKind>;

/** How long rows are kept unless the person changes it, and the range Settings allows. */
export const SIGHT_LOG_DEFAULT_DAYS = 7;
export const MIN_SIGHT_LOG_DAYS = 1;
export const MAX_SIGHT_LOG_DAYS = 30;

const count = z.number().int().nonnegative();

export const SightLogEntry = z.object({
  id: z.string().min(1),
  kind: SightKind,
  at: z.iso.datetime(),
  /** The app looked at. A blind spot or an excluded window keeps this and loses its title. */
  app: z.string().min(1).optional(),
  /** The window title, with secrets hidden. */
  title: z.string().min(1).optional(),
  /** `sent_to_ai`: the brain the request went to. */
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** `sent_to_expert`: the expert, by its name when the brief went. */
  expertName: z.string().min(1).optional(),
  /** `listed_windows`: how many windows were listed. */
  windows: count.optional(),
  /** How many characters were read or sent. */
  chars: count.optional(),
  /** How many pictures were taken or sent. */
  images: count.optional(),
  /** `read_text`: from the accessibility tree, or recognised from pixels. */
  source: z.enum(['uia', 'ocr']).optional(),
});
export type SightLogEntry = z.infer<typeof SightLogEntry>;

/** Newest first. */
export const SightLogListParams = z.object({
  limit: z.number().int().positive().max(1000).default(200),
});
export const SightLogListResult = z.object({ entries: z.array(SightLogEntry) });
export const SightLogDeleteParams = z.object({ id: z.string().min(1) });
export const SightLogDeleteResult = z.object({ deleted: z.boolean() });
export const SightLogClearParams = z.object({});
export const SightLogClearResult = z.object({ deleted: count });
export type SightLogListParams = z.input<typeof SightLogListParams>;
export type SightLogListResult = z.infer<typeof SightLogListResult>;
