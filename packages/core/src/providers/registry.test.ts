/** Tests for createProvider: each provider id, base URLs, missing keys and fake mode. */
import { describe, expect, it, vi } from 'vitest';
import { BrainError } from './errors';
import { FakeBrainProvider } from './fake';
import { AnthropicProvider } from './anthropic';
import { ClaudeCodeBrain } from './claude-code-brain';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { createProvider } from './registry';
import type { BrainProvider } from './brain';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {},
  APIError: class APIError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
  AuthenticationError: class AuthenticationError extends Error {},
  APIConnectionError: class APIConnectionError extends Error {},
  APIUserAbortError: class APIUserAbortError extends Error {},
}));

/** The URL the built provider's first request goes to. The stubbed network refuses it. */
async function firstRequestUrl(build: () => BrainProvider): Promise<string> {
  const urls: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(new Response('{}', { status: 401 }));
  });
  try {
    const provider = build();
    const events = { onText: () => {}, onToolUse: () => Promise.resolve({ content: '' }) };
    const request = { model: 'm', system: '', messages: [], maxTokens: 1 };
    await provider.complete(request, events, new AbortController().signal).catch(() => {});
  } finally {
    vi.unstubAllGlobals();
  }
  return urls[0] ?? '';
}

describe('createProvider', () => {
  it('builds the Anthropic provider from settings', () => {
    const provider = createProvider({ providerId: 'anthropic', apiKey: 'k', env: {} });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.id).toBe('anthropic');
  });

  it('builds the Claude Code provider with no key: it uses the Claude Code sign-in', () => {
    const provider = createProvider({ providerId: 'claude-code', env: {} });
    expect(provider).toBeInstanceOf(ClaudeCodeBrain);
    expect(provider.id).toBe('claude-code');
  });

  it('builds the OpenRouter provider, which sees', () => {
    const provider = createProvider({ providerId: 'openrouter', apiKey: 'k', env: {} });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.id).toBe('openrouter');
    expect(provider.capabilities.vision).toBe(true);
  });

  it('treats the retired nebius provider as unknown', () => {
    try {
      createProvider({ providerId: 'nebius', apiKey: 'k', env: {} });
      expect.unreachable('expected a BrainError');
    } catch (error) {
      expect(error).toBeInstanceOf(BrainError);
      expect((error as BrainError).code).toBe('config');
      expect((error as BrainError).message).not.toContain("'nebius',");
    }
  });

  it('sends OpenRouter requests to the OpenRouter URL', async () => {
    const url = await firstRequestUrl(() =>
      createProvider({ providerId: 'openrouter', apiKey: 'k', env: {} }),
    );
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('uses a base URL from settings over the preset one', async () => {
    const url = await firstRequestUrl(() =>
      createProvider({
        providerId: 'openrouter',
        apiKey: 'k',
        baseURL: 'http://127.0.0.1:8000/v1/',
        env: {},
      }),
    );
    expect(url).toBe('http://127.0.0.1:8000/v1/chat/completions');
  });

  it('refuses to build the OpenRouter provider without an API key', () => {
    expect(() => createProvider({ providerId: 'openrouter', env: {} })).toThrow('OpenRouter');
  });

  it('says which service has no key, as an auth error', () => {
    try {
      createProvider({ providerId: 'openrouter', env: {} });
      expect.unreachable('expected a BrainError');
    } catch (error) {
      expect((error as BrainError).code).toBe('auth');
      expect((error as BrainError).message).toContain('OpenRouter');
    }
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
