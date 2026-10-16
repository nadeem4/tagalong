/**
 * A pet: the on-screen companion, Scout, as data (role, model, provider). Contains Pet and
 * SCOUT_ID.
 */
import { z } from 'zod';

/** Scout's id: the one pet there is. */
export const SCOUT_ID = 'scout';

/**
 * One pet. Parsing drops unknown keys, so a pet saved by an older version, with fields
 * since removed, still parses.
 */
export const Pet = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Emoji or an asset key the host knows how to render. */
  avatar: z.string().min(1),
  /**
   * The pet's colour, as `#rrggbb`: its sprite's fur when it has no character of its own.
   * Optional so a pet saved without one still parses; hosts pick a neutral one.
   */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'a colour is #rrggbb')
    .optional(),
  /** The role this pet does: a role library id, `companion` for Scout. */
  roleId: z.string().min(1),
  /** The model that answers text turns. */
  model: z.string().min(1),
  /**
   * The small, cheap model that answers a watch's frequent yes-or-no check, on the pet's
   * own provider. Absent means that provider's default: Claude Haiku on OpenRouter and
   * Anthropic.
   */
  watchModel: z.string().min(1).optional(),
  /** BrainProvider id: 'claude-code', 'openrouter', 'anthropic' or 'fake'. */
  providerId: z.string().min(1),
});
export type Pet = z.infer<typeof Pet>;
