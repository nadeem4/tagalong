import { z } from 'zod';

/** How much of an answer is spoken aloud. Phase 3 gives these teeth. */
export const ReplyStyle = z.enum(['text', 'voice-summary', 'voice-full']);
export type ReplyStyle = z.infer<typeof ReplyStyle>;

/** Whether a pet may use one of its role's tools. Phase 8. */
export const ToolGrant = z.enum(['off', 'allowed']);
export type ToolGrant = z.infer<typeof ToolGrant>;

/**
 * One companion. A pet is entirely data: role, notes, model, and grants.
 * Adding a pet never means adding code.
 *
 * Stored pets saved before Phase 8 carried `persona` and `toolAllowlist`; parsing drops
 * unknown keys, so such JSON still parses, and the roles migration moves `persona` to
 * `notes` where the user had changed it.
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
  /** Phase 8. The role this pet does: a role library id such as `backend-engineer`. */
  roleId: z.string().min(1),
  /** Phase 8. The role's version when the pet last took it on. */
  roleVersion: z.number().int().positive(),
  /** Phase 8. The user's own private notes for this pet, added to its instructions. */
  notes: z.string().optional(),
  /** The model that answers text turns. */
  model: z.string().min(1),
  /**
   * The model a turn switches to when it carries an image and `model` cannot see.
   * Optional: a pet on a model that sees, or a provider whose models all do, needs none.
   */
  visionModel: z.string().min(1).optional(),
  /**
   * Phase 3B. The small, cheap model that answers a watch's frequent yes-or-no check, on
   * the pet's own provider. Absent means that provider's default — Nemotron 3 Nano on
   * Token Factory, Claude Haiku on OpenRouter and Anthropic.
   */
  watchModel: z.string().min(1).optional(),
  /** BrainProvider id: 'nebius', 'anthropic' or 'fake'. Each pet picks its own. */
  providerId: z.string().min(1),
  /** Phase 3. */
  voiceId: z.string().optional(),
  /**
   * Phase 8. Tool id to `off` or `allowed`. A tool the role lists and this map leaves out is
   * allowed, so the default `{}` means every tool the role lists.
   */
  toolGrants: z.record(z.string(), ToolGrant).default({}),
  replyStyle: ReplyStyle.default('text'),
});
export type Pet = z.infer<typeof Pet>;
