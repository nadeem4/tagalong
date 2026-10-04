/**
 * The brain layer's public surface. The runner imports from here, never from a
 * concrete provider module, so adding Ollama later stays a one-file change.
 */
export type {
  BrainCapabilities,
  BrainContent,
  BrainContentBlock,
  BrainEvents,
  BrainMessage,
  BrainProvider,
  BrainRequest,
  BrainResult,
  BrainTool,
} from './brain';
export { BrainError, type BrainErrorCode } from './errors';
export {
  ANTHROPIC_MODELS,
  AnthropicProvider,
  REFUSAL_MESSAGE,
  type AnthropicProviderOptions,
} from './anthropic';
export { FAKE_MODELS, FakeBrainProvider, type FakeScript } from './fake';
export {
  NEBIUS_BASE_URL,
  OpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from './openai-compatible';
export {
  NEBIUS_FALLBACK_MODELS,
  NEBIUS_VISION_MODELS,
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
} from './nebius-models';
export { createProvider, type ProviderConfig } from './registry';
export { KeyedProviderResolver, type KeyedProviderResolverOptions } from './key-resolver';
export { carriesImage, modelForTurn } from './vision-routing';
export { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, openAiPreset, type OpenAiPreset } from './presets';
export {
  NEMOTRON_NANO_MODEL,
  WATCH_MODEL_DEFAULTS,
  watchModelsFor,
  type WatchModels,
} from './watch-models';
