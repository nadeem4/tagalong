/**
 * `MODEL_TIERS`: the model each role tier (fast, balanced, deep) recommends on each
 * provider.
 */
import type { ModelTier } from '@tagalong/protocol';

/** The model each tier maps to on one provider. */
export type ProviderTiers = Readonly<Record<ModelTier, string>>;

/**
 * The model a role's tier recommends on each provider. Only a recommendation: a pet can
 * pick any model on its provider's live list.
 */
export const MODEL_TIERS: Readonly<Record<string, ProviderTiers>> = {
  openrouter: {
    fast: 'anthropic/claude-haiku-4.5',
    balanced: 'anthropic/claude-sonnet-5',
    deep: 'anthropic/claude-opus-5',
  },
  anthropic: { fast: 'claude-haiku-4-5', balanced: 'claude-sonnet-5', deep: 'claude-opus-5' },
  'claude-code': { fast: 'haiku', balanced: 'sonnet', deep: 'opus' },
};
