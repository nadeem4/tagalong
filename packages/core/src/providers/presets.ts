/**
 * The OpenAI-compatible services the app knows by name (OpenRouter).
 * Contains `OPENAI_COMPATIBLE_PRESETS`, `openAiPreset` and `SECRET_KEYS` (where each
 * provider's key is filed in the SecretStore).
 */
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
}

/**
 * OpenRouter fallback ids, not checked against the live list
 * (`GET https://openrouter.ai/api/v1/models`), which replaces them in Settings once a key
 * is stored.
 */
const OPENROUTER_FALLBACK_MODELS: readonly string[] = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
];

export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, OpenAiPreset>> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    fallbackModels: OPENROUTER_FALLBACK_MODELS,
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
  openrouter: 'openrouter.apiKey',
};
