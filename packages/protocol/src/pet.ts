import { z } from 'zod';

/** How much of an answer is spoken aloud. Phase 3 gives these teeth. */
export const ReplyStyle = z.enum(['text', 'voice-summary', 'voice-full']);
export type ReplyStyle = z.infer<typeof ReplyStyle>;

/**
 * One companion. A pet is entirely data: persona, model, and permissions.
 * Adding a pet never means adding code.
 */
export const Pet = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Emoji or an asset key the host knows how to render. */
  avatar: z.string().min(1),
  /**
   * Phase 4. The pet's colour in the crew strip and the panel header, as `#rrggbb`.
   * Optional so a pet saved before the crew existed still parses; hosts pick a neutral one.
   */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'a colour is #rrggbb')
    .optional(),
  /** System prompt fragment describing personality and role. */
  persona: z.string(),
  /** The model that answers text turns. */
  model: z.string().min(1),
  /**
   * The model a turn switches to when it carries an image and `model` cannot see.
   * Optional: a pet on a model that sees, or a provider whose models all do, needs none.
   */
  visionModel: z.string().min(1).optional(),
  /** BrainProvider id: 'nebius', 'anthropic' or 'fake'. Each pet picks its own. */
  providerId: z.string().min(1),
  /** Phase 3. */
  voiceId: z.string().optional(),
  /** Phase 5. Entries look like 'notion__search'. */
  toolAllowlist: z.array(z.string()).default([]),
  replyStyle: ReplyStyle.default('text'),
});
export type Pet = z.infer<typeof Pet>;
