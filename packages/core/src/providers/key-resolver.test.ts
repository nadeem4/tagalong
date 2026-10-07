import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { InMemorySecretStore } from '../settings/settings';
import { BrainError } from './errors';
import { FakeBrainProvider } from './fake';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { SECRET_KEYS } from './presets';
import { KeyedProviderResolver } from './key-resolver';

const pet = (providerId: string): Pet => ({
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: 'p',
  model: 'm',
  providerId,
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text',
});

function resolverWith(
  secrets: InMemorySecretStore,
  baseUrls: Record<string, string> = {},
  env: Record<string, string | undefined> = {},
): KeyedProviderResolver {
  return new KeyedProviderResolver({ secrets, baseUrl: (id) => baseUrls[id], env });
}

describe('KeyedProviderResolver', () => {
  it('refuses a provider with no key, naming where to add one', async () => {
    const resolver = resolverWith(new InMemorySecretStore());
    await resolver.refresh();
    expect(() => resolver.resolve(pet('nebius'))).toThrow(BrainError);
  });

  it('picks up a key saved after boot on the next refresh, without a restart', async () => {
    const secrets = new InMemorySecretStore();
    const resolver = resolverWith(secrets);
    await resolver.refresh();
    expect(() => resolver.resolve(pet('nebius'))).toThrow(BrainError);

    // What the onboarding wizard does: the key lands in the keychain while the app runs.
    await secrets.set(SECRET_KEYS.nebius!, 'nb-test');
    await resolver.refresh();

    expect(resolver.resolve(pet('nebius'))).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it('reuses one provider while its key and base URL are unchanged', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.openrouter!, 'or-1');
    const resolver = resolverWith(secrets);
    await resolver.refresh();
    const first = resolver.resolve(pet('openrouter'));
    await resolver.refresh();
    expect(resolver.resolve(pet('openrouter'))).toBe(first);
  });

  it('rebuilds a provider whose key was replaced', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.openrouter!, 'or-1');
    const resolver = resolverWith(secrets);
    await resolver.refresh();
    const first = resolver.resolve(pet('openrouter'));

    await secrets.set(SECRET_KEYS.openrouter!, 'or-2');
    await resolver.refresh();

    expect(resolver.resolve(pet('openrouter'))).not.toBe(first);
  });

  it('rebuilds a provider whose base URL changed', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.openrouter!, 'or-1');
    const urls: Record<string, string> = {};
    const resolver = resolverWith(secrets, urls);
    await resolver.refresh();
    const first = resolver.resolve(pet('openrouter'));

    urls.openrouter = 'https://gateway.example.com/v1';

    expect(resolver.resolve(pet('openrouter'))).not.toBe(first);
  });

  it('stays on the fake brain in fake mode whatever is stored', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.anthropic!, 'sk-ant');
    const resolver = resolverWith(secrets, {}, { TAGALONG_FAKE_PROVIDERS: '1' });
    await resolver.refresh();
    expect(resolver.resolve(pet('anthropic'))).toBeInstanceOf(FakeBrainProvider);
  });
});
