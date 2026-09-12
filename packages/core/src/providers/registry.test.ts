import { describe, expect, it, vi } from 'vitest';
import { BrainError } from './errors';
import { FakeBrainProvider } from './fake';
import { AnthropicProvider } from './anthropic';
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
