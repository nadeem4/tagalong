import type { ModelTier } from '@tagalong/protocol';
import {
  NEMOTRON_NANO_MODEL,
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
} from '../providers/nebius-models';

/** The model each tier maps to on one provider, plus the model that sees when it cannot. */
export type ProviderTiers = Readonly<Record<ModelTier, string>> & { readonly vision?: string };

/**
 * The model a role's tier recommends on each provider. Only a recommendation: a pet can
 * pick any model on its provider's live list. A provider whose models all see needs no
 * `vision` entry.
 */
export const MODEL_TIERS: Readonly<Record<string, ProviderTiers>> = {
  openrouter: {
    fast: 'anthropic/claude-haiku-4.5',
    balanced: 'anthropic/claude-sonnet-5',
    deep: 'anthropic/claude-opus-5',
  },
  anthropic: { fast: 'claude-haiku-4-5', balanced: 'claude-sonnet-5', deep: 'claude-opus-5' },
  nebius: {
    fast: NEMOTRON_NANO_MODEL,
    balanced: NEMOTRON_TEXT_MODEL,
    deep: NEMOTRON_TEXT_MODEL,
    vision: NEMOTRON_VISION_MODEL,
  },
};
