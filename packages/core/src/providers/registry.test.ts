import { describe, expect, it, vi } from 'vitest';
import { BrainError } from './errors';
import { FakeBrainProvider } from './fake';
import { AnthropicProvider } from './anthropic';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL } from './nebius-models';
import { createProvider } from './registry';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {},
  APIError: class APIError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
  AuthenticationError: class AuthenticationError extends Error {},
  APIConnectionError: class APIConnectionError extends Error {},
  APIUserAbortError: class APIUserAbortError extends Error {},
}));

describe('createProvider', () => {
  it('builds the Anthropic provider from settings', () => {
    const provider = createProvider({ providerId: 'anthropic', apiKey: 'k', env: {} });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.id).toBe('anthropic');
  });

  it('builds the Token Factory provider as nebius', () => {
    const provider = createProvider({ providerId: 'nebius', apiKey: 'k', env: {} });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.id).toBe('nebius');
  });

  it('tells the runner that only the Nemotron VL model sees on Token Factory', () => {
    const provider = createProvider({ providerId: 'nebius', apiKey: 'k', env: {} });
    expect(provider.canSee?.(NEMOTRON_VISION_MODEL)).toBe(true);
    expect(provider.canSee?.(NEMOTRON_TEXT_MODEL)).toBe(false);
  });

  it('builds the OpenRouter provider, whose models all see', () => {
    const provider = createProvider({ providerId: 'openrouter', apiKey: 'k', env: {} });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.id).toBe('openrouter');
    expect((provider as OpenAiCompatibleProvider).baseURL).toBe('https://openrouter.ai/api/v1');
    expect(provider.canSee?.('anthropic/claude-sonnet-5')).toBe(true);
  });

  it('uses a base URL from settings over the preset one', () => {
    const provider = createProvider({
      providerId: 'nebius',
      apiKey: 'k',
      baseURL: 'http://127.0.0.1:8000/v1/',
      env: {},
    });
    expect((provider as OpenAiCompatibleProvider).baseURL).toBe('http://127.0.0.1:8000/v1/');
  });

  it('refuses to build the OpenRouter provider without an API key', () => {
    expect(() => createProvider({ providerId: 'openrouter', env: {} })).toThrow('OpenRouter');
  });

  it('refuses to build the Token Factory provider without an API key', () => {
    try {
      createProvider({ providerId: 'nebius', env: {} });
      expect.unreachable('expected a BrainError');
    } catch (error) {
      expect((error as BrainError).code).toBe('auth');
      expect((error as BrainError).message).toContain('Token Factory');
    }
  });

  it('forces the fake provider over nebius when TAGALONG_FAKE_PROVIDERS is set', () => {
    const provider = createProvider({
      providerId: 'nebius',
      apiKey: 'k',
      env: { TAGALONG_FAKE_PROVIDERS: '1' },
    });
    expect(provider).toBeInstanceOf(FakeBrainProvider);
  });

  it('builds the fake provider', () => {
    const provider = createProvider({ providerId: 'fake', env: {} });
    expect(provider).toBeInstanceOf(FakeBrainProvider);
  });

  it('forces the fake provider when TAGALONG_FAKE_PROVIDERS is set', () => {
    const provider = createProvider({
      providerId: 'anthropic',
      apiKey: 'k',
      env: { TAGALONG_FAKE_PROVIDERS: '1' },
    });
    expect(provider).toBeInstanceOf(FakeBrainProvider);
  });

  it('rejects an unknown provider id with a readable error', () => {
    expect(() => createProvider({ providerId: 'ollama', env: {} })).toThrow(BrainError);
    try {
      createProvider({ providerId: 'ollama', env: {} });
    } catch (error) {
      expect((error as BrainError).code).toBe('config');
      expect((error as BrainError).message).toContain('ollama');
    }
  });

  it('refuses to build the Anthropic provider without an API key', () => {
    try {
      createProvider({ providerId: 'anthropic', env: {} });
      expect.unreachable('expected a BrainError');
    } catch (error) {
      expect((error as BrainError).code).toBe('auth');
    }
  });
});
