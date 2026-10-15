import { z } from 'zod';

/**
 * Pick up where you left off. Scout keeps one snapshot of what you were in the middle of,
 * from window titles only, and offers it once when you come back after a long break.
 * Nothing opens or runs without a click on the card.
 */

/** The editors a project reopens in: VS Code and Cursor by their own links, others as a folder. */
export const PickUpEditor = z.enum(['vscode', 'cursor', 'other']);
export type PickUpEditor = z.infer<typeof PickUpEditor>;

/** A project you had open in an editor: its folder, the branch it was on, the file in front. */
export const PickUpProject = z.object({
  id: z.string().min(1),
  kind: z.literal('project'),
  name: z.string().min(1),
  path: z.string().min(1),
  editor: PickUpEditor,
  branch: z.string().min(1).optional(),
  /** A file name from the window title, kept as a name only; it is never read. */
  file: z.string().min(1).optional(),
});
export type PickUpProject = z.infer<typeof PickUpProject>;

/** A hand-off left half done: a brief never sent, or a run that stopped or failed. */
export const PickUpHandoff = z.object({
  id: z.string().min(1),
  kind: z.literal('handoff'),
  expertName: z.string().min(1),
  /** The ask alone: a brief's selected text is never kept. */
  ask: z.string().min(1),
  state: z.enum(['unsent', 'stopped', 'error']),
});
export type PickUpHandoff = z.infer<typeof PickUpHandoff>;

export const PickUpItem = z.discriminatedUnion('kind', [PickUpProject, PickUpHandoff]);
export type PickUpItem = z.infer<typeof PickUpItem>;

/** The one line Scout says when you are back, and what the card lists. */
export const PickUpReadyParams = z.object({
  text: z.string().min(1),
  items: z.array(PickUpItem).min(1),
});
export type PickUpReadyParams = z.infer<typeof PickUpReadyParams>;

/** Brief again: the saved ask goes to the hand-off card, unsent. */
export const PickUpRebriefParams = z.object({ itemId: z.string().min(1) });
export const PickUpRebriefResult = z.object({ proposed: z.boolean() });

/** Not now: the offer is dropped and a new snapshot starts. */
export const PickUpDismissParams = z.object({});
export const PickUpDismissResult = z.object({ dismissed: z.boolean() });
