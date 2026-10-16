/**
 * The OpenAI-compatible services the app knows by name (Nebius Token Factory, OpenRouter).
 * Contains `OPENAI_COMPATIBLE_PRESETS`, `openAiPreset` and `SECRET_KEYS` (where each
 * provider's key is filed in the SecretStore).
 */
import { NEBIUS_FALLBACK_MODELS, NEBIUS_VISION_MODELS } from './nebius-models';
import { NEBIUS_BASE_URL } from './openai-compatible';

/**
 * One OpenAI-format service the app knows by name.
 *
 * A preset is only defaults: the base URL can be overridden in settings
 * (`providerBaseUrls`), the key lives in the keychain, and the model is whatever id the
 * pet names. So pointing a pet at another OpenAI-compatible service is configuration,
 * never code.
 */
export interface OpenAiPreset {
  id: string;
  /** Shown in Settings and in error messages. */
  label: string;
  baseURL: string;
  /** Listed in `.env.example` for reference; the key itself is entered in Settings. */
  envVar: string;
  /** Offered in the model picker when the live list cannot be fetched. */
  fallbackModels: readonly string[];
  /** The models that accept images. Absent means every model does. */
  visionModels?: readonly string[] | undefined;
}

/**
 * OpenRouter fallback ids, not checked against the live list
 * (`GET https://openrouter.ai/api/v1/models`), which replaces them in Settings once a key
 * is stored.
 */
const OPENROUTER_FALLBACK_MODELS: readonly string[] = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
  'nvidia/nemotron-3-super-120b-a12b',
];

export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, OpenAiPreset>> = {
  nebius: {
    id: 'nebius',
    label: 'Token Factory',
    baseURL: NEBIUS_BASE_URL,
    envVar: 'NEBIUS_API_KEY',
    fallbackModels: NEBIUS_FALLBACK_MODELS,
    // Token Factory serves text-only and vision models side by side, so a turn that
    // carries an image is routed to the pet's vision model.
    visionModels: NEBIUS_VISION_MODELS,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    fallbackModels: OPENROUTER_FALLBACK_MODELS,
    // No vision list: OpenRouter fronts hundreds of models and most a person would pick
    // for this see. With Claude, the one model answers text and pictures alike.
  },
};

/** The preset for a provider id, or undefined when it is not an OpenAI-compatible one. */
export function openAiPreset(providerId: string): OpenAiPreset | undefined {
  return Object.hasOwn(OPENAI_COMPATIBLE_PRESETS, providerId)
    ? OPENAI_COMPATIBLE_PRESETS[providerId]
    : undefined;
}

/** Where each provider's API key is filed in the host's SecretStore. */
export const SECRET_KEYS: Readonly<Record<string, string>> = {
  anthropic: 'anthropic.apiKey',
  nebius: 'nebius.apiKey',
  openrouter: 'openrouter.apiKey',
};
