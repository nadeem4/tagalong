import { z } from 'zod';

/** How much brain a role wants. Each provider maps a tier to one of its models. */
export const ModelTier = z.enum(['fast', 'balanced', 'deep']);
export type ModelTier = z.infer<typeof ModelTier>;

/**
 * A job a pet does: what it is good at, the tools it reaches for, and the model it would
 * like. Compiled from `packages/core/roles/*.md`. The role only recommends a model; the
 * pet's own model setting always wins.
 */
export const Role = z.object({
  /** Kebab-case, and the role file's name without `.md`. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a role id is kebab-case'),
  name: z.string().min(1),
  /** Bumped when the instructions change enough that a pet should notice. */
  version: z.number().int().positive(),
  summary: z.string().min(1),
  goodAt: z.array(z.string().min(1)),
  notFor: z.array(z.string().min(1)),
  /** Built-in tool names, such as `look_at_screen`. */
  tools: z.array(z.string().min(1)),
  model: z.object({
    tier: ModelTier,
    needsVision: z.boolean(),
  }),
  /** The Markdown body of the role file. */
  instructions: z.string().min(1),
});
export type Role = z.infer<typeof Role>;

/** Phase 8. Every role in the engine's library, for the role picker and the office labels. */
export const RolesListParams = z.object({});
export const RolesListResult = z.object({ roles: z.array(Role) });

/**
 * Phase 8. The model a pet with this role would start on, on this provider, so a form can
 * prefill it. Both fields are absent when the provider has no tier table, such as `fake`.
 */
export const RolesRecommendModelParams = z.object({
  roleId: z.string().min(1),
  providerId: z.string().min(1),
});
export const RolesRecommendModelResult = z.object({
  model: z.string().min(1).optional(),
  visionModel: z.string().min(1).optional(),
});
