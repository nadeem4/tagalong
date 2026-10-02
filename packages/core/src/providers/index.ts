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
export { AnthropicProvider, REFUSAL_MESSAGE, type AnthropicProviderOptions } from './anthropic';
export { FakeBrainProvider, type FakeScript } from './fake';
export {
  NEBIUS_BASE_URL,
  OpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from './openai-compatible';
export {
  NEBIUS_FALLBACK_MODELS,
  NEMOTRON_TEXT_MODEL,
  NEMOTRON_VISION_MODEL,
} from './nebius-models';
export { createProvider, type ProviderConfig } from './registry';
