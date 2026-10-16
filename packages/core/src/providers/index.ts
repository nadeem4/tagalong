/**
 * The brain layer's public surface: the contract types, each provider, `createProvider`,
 * the key resolver, presets and model ids. Most code outside this folder imports from here;
 * the engine (guard, record, key check), roles (presets) and usage (the brain
 * types) import a file directly.
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
export { REFUSAL_MESSAGE } from './brain';
export { BrainError, type BrainErrorCode } from './errors';
export { ANTHROPIC_MODELS, AnthropicProvider } from './anthropic';
export { CLAUDE_CODE_MODELS, ClaudeCodeBrain } from './claude-code-brain';
export { FAKE_MODELS, FakeBrainProvider, type FakeScript } from './fake';
export { OpenAiCompatibleProvider } from './openai-compatible';
export { createProvider, type ProviderConfig } from './registry';
export { KeyedProviderResolver } from './key-resolver';
export { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, openAiPreset, type OpenAiPreset } from './presets';
export { WATCH_MODEL_DEFAULTS, watchModelsFor } from './watch-models';
