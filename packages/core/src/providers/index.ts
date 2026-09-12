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
export { createProvider, type ProviderConfig } from './registry';
