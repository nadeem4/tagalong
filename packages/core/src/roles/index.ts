import type { Role } from '@tagalong/protocol';
import { openAiPreset } from '../providers/presets';
import { ROLE_LIBRARY } from './library.generated';
import { MODEL_TIERS } from './tiers';

export { ROLE_LIBRARY };
export { MODEL_TIERS, type ProviderTiers } from './tiers';

/** Every role Tagalong ships, in id order. */
export function listRoles(): readonly Role[] {
  return ROLE_LIBRARY;
}

/** The role with this id, or undefined when there is none. */
export function getRole(id: string): Role | undefined {
  return ROLE_LIBRARY.find((role) => role.id === id);
}

export interface RecommendedModel {
  model: string;
  /** Set only when the role needs pictures and `model` cannot see them. */
  visionModel?: string;
}

/**
 * The model a new pet with this role starts on, for its provider, or undefined when the
 * provider has no tier table. Whether a model sees comes from the provider preset's vision
 * list; a provider without one sees with every model.
 */
export function recommendedModel(role: Role, providerId: string): RecommendedModel | undefined {
  const tiers = Object.hasOwn(MODEL_TIERS, providerId) ? MODEL_TIERS[providerId] : undefined;
  if (tiers === undefined) return undefined;
  const model = tiers[role.model.tier];
  const visionModels = openAiPreset(providerId)?.visionModels;
  const sees = visionModels === undefined || visionModels.includes(model);
  if (!role.model.needsVision || sees || tiers.vision === undefined) return { model };
  return { model, visionModel: tiers.vision };
}
