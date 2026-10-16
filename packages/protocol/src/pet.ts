/**
 * A pet: the on-screen companion as data (role, model, provider, notes, grants).
 * Adding a pet never means adding code. Contains Pet, ReplyStyle and ToolGrant.
 */
import { z } from 'zod';

/**
 * How the pet writes its answer: for the screen, or to be spoken as a summary or in full.
 * It sets one line of the system prompt.
 */
export const ReplyStyle = z.enum(['text', 'voice-summary', 'voice-full']);
export type ReplyStyle = z.infer<typeof ReplyStyle>;

/** Whether a pet may use one of its role's tools. */
export const ToolGrant = z.enum(['off', 'allowed']);
export type ToolGrant = z.infer<typeof ToolGrant>;

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
  /** The user's own private notes for this pet, added to its instructions. */
  notes: z.string().optional(),
  /** The model that answers text turns. */
  model: z.string().min(1),
  /**
   * The model a turn switches to when it carries an image and `model` cannot see.
   * Optional: a pet on a model that sees, or a provider whose models all do, needs none.
   */
  visionModel: z.string().min(1).optional(),
  /**
   * The small, cheap model that answers a watch's frequent yes-or-no check, on the pet's
   * own provider. Absent means that provider's default: Nemotron 3 Nano on
   * Token Factory, Claude Haiku on OpenRouter and Anthropic.
   */
  watchModel: z.string().min(1).optional(),
  /** BrainProvider id: 'claude-code', 'nebius', 'openrouter', 'anthropic' or 'fake'. */
  providerId: z.string().min(1),
  /**
   * Tool id to `off` or `allowed`. A tool the role lists and this map leaves out is
   * allowed, so the default `{}` means every tool the role lists.
   */
  toolGrants: z.record(z.string(), ToolGrant).default({}),
  replyStyle: ReplyStyle.default('text'),
});
export type Pet = z.infer<typeof Pet>;
