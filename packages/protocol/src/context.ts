import { z } from 'zod';

/** Which host produced a snapshot. Hosts differ in what they can perceive. */
export const HostKind = z.enum(['desktop', 'extension']);
export type HostKind = z.infer<typeof HostKind>;

/** A selection is always kept whole up to this length; beyond it the host truncates. */
export const MAX_SELECTION_CHARS = 20_000;

/** Readable page text ceiling. The prompt budget in settings may cut it further. */
export const MAX_PAGE_TEXT_CHARS = 40_000;

/**
 * What a host saw at the moment the user asked. Every field beyond the identity
 * triple is optional, because hosts advertise different capabilities.
 */
export const ContextSnapshot = z.object({
  id: z.uuid(),
  capturedAt: z.iso.datetime(),
  host: HostKind,
  app: z
    .object({
      name: z.string().min(1),
      windowTitle: z.string().optional(),
    })
    .optional(),
  selection: z.string().max(MAX_SELECTION_CHARS).optional(),
  clipboard: z.string().optional(),
  /** Supplied by the extension host only; the desktop host cannot read page text. */
  page: z
    .object({
      url: z.url(),
      title: z.string(),
      text: z.string().max(MAX_PAGE_TEXT_CHARS),
    })
    .optional(),
  /** Phase 2. PNG only, so providers get one predictable image format. */
  screenshot: z
    .object({
      mime: z.literal('image/png'),
      base64: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshot>;

/** What a host returns from perception.capture: whichever fields it managed to read. */
export const ContextSnapshotPatch = ContextSnapshot.partial();
export type ContextSnapshotPatch = z.infer<typeof ContextSnapshotPatch>;

/** The things a host can be asked to perceive. */
export const PerceptionTarget = z.enum([
  'selection',
  'screenshot',
  'activeWindow',
  'clipboard',
  'pageText',
]);
export type PerceptionTarget = z.infer<typeof PerceptionTarget>;
