/** Tests for the brain list, key names and stored keys. */

import { InMemorySecretStore } from '@tagalong/core';
import { describe, expect, it } from 'vitest';
import {
  ELEVENLABS_SECRET_KEY,
  forgetRetiredKeys,
  providerChoices,
  secretKeyFor,
  storedKeys,
} from './provider-choices';

describe('providerChoices', () => {
  it('offers the Claude Code sign-in first, then the presets, Anthropic and the fake', () => {
    const choices = providerChoices(new Set());
    expect(choices.map((choice) => choice.id)).toEqual([
      'claude-code',
      'openrouter',
      'anthropic',
      'fake',
    ]);
  });

  it('carries each preset default base URL for the form', () => {
    const [, openrouter] = providerChoices(new Set());
    expect(openrouter).toMatchObject({
      label: 'OpenRouter',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      needsKey: true,
    });
  });

  it('does not send the environment variable name, which no window reads', () => {
    for (const choice of providerChoices(new Set())) {
      expect(choice).not.toHaveProperty('envVar');
    }
  });

  it('says which keys are stored, never what they are', () => {
    const choices = providerChoices(new Set(['openrouter']));
    expect(choices.find((c) => c.id === 'openrouter')?.hasKey).toBe(true);
    expect(choices.find((c) => c.id === 'anthropic')?.hasKey).toBe(false);
    expect(JSON.stringify(choices)).not.toContain('apiKey');
  });

  it('asks for no key for Claude Code: it thinks through the Claude Code sign-in', () => {
    const claude = providerChoices(new Set()).find((c) => c.id === 'claude-code');
    expect(claude).toEqual({
      id: 'claude-code',
      label: 'Your Claude sign-in',
      needsKey: false,
      hasKey: false,
    });
  });

  it('asks for no key and no URL for the fake provider', () => {
    const fake = providerChoices(new Set()).find((c) => c.id === 'fake');
    expect(fake).toEqual({
      id: 'fake',
      label: 'Fake (offline demo)',
      needsKey: false,
      hasKey: false,
    });
  });
});

describe('secretKeyFor', () => {
  it('stores the ElevenLabs key like any other, though it is not a brain', () => {
    expect(secretKeyFor('elevenlabs')).toBe(ELEVENLABS_SECRET_KEY);
    expect(ELEVENLABS_SECRET_KEY).toBe('elevenlabs.apiKey');
    expect(providerChoices(new Set()).some((choice) => choice.id === 'elevenlabs')).toBe(false);
  });

  it('refuses a provider that takes no key', () => {
    expect(secretKeyFor('fake')).toBeUndefined();
  });

  it('has no key for the retired nebius provider', () => {
    expect(secretKeyFor('nebius')).toBeUndefined();
  });
});

describe('storedKeys', () => {
  it('names the providers with a key in the keychain, and never returns a key', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(secretKeyFor('openrouter')!, 'sk-or');
    await secrets.set(secretKeyFor('anthropic')!, '');
    expect(await storedKeys(secrets)).toEqual(new Set(['openrouter']));
  });
});

describe('forgetRetiredKeys', () => {
  it('deletes the retired nebius key and keeps every other key', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set('nebius.apiKey', 'sk-nb');
    await secrets.set('openrouter.apiKey', 'sk-or');
    await forgetRetiredKeys(secrets);
    expect(await secrets.get('nebius.apiKey')).toBeNull();
    expect(await secrets.get('openrouter.apiKey')).toBe('sk-or');
  });

  it('never rewrites the store when no retired key is there', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set('openrouter.apiKey', 'sk-or');
    const deleted: string[] = [];
    const del = secrets.delete.bind(secrets);
    secrets.delete = async (key) => {
      deleted.push(key);
      await del(key);
    };
    await forgetRetiredKeys(secrets);
    expect(deleted).toEqual([]);
  });

  it('leaves the entry when the store cannot read it', async () => {
    const secrets = new InMemorySecretStore();
    const deleted: string[] = [];
    secrets.get = () => Promise.reject(new Error('no backend'));
    secrets.delete = async (key) => {
      deleted.push(key);
    };
    await expect(forgetRetiredKeys(secrets)).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
  });
});
