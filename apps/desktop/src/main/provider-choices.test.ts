import { describe, expect, it } from 'vitest';
import { providerChoices } from './provider-choices';

describe('providerChoices', () => {
  it('offers the two OpenAI-compatible presets first, then Anthropic and the fake', () => {
    const choices = providerChoices(new Set());
    expect(choices.map((choice) => choice.id)).toEqual([
      'openrouter',
      'nebius',
      'anthropic',
      'fake',
    ]);
  });

  it('carries each preset default base URL and key variable for the form', () => {
    const [openrouter, nebius] = providerChoices(new Set());
    expect(openrouter).toMatchObject({
      label: 'OpenRouter',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      envVar: 'OPENROUTER_API_KEY',
      needsKey: true,
    });
    expect(nebius).toMatchObject({
      label: 'Token Factory',
      defaultBaseUrl: 'https://api.tokenfactory.nebius.com/v1/',
      envVar: 'NEBIUS_API_KEY',
    });
  });

  it('says which keys are stored, never what they are', () => {
    const choices = providerChoices(new Set(['nebius']));
    expect(choices.find((c) => c.id === 'nebius')?.hasKey).toBe(true);
    expect(choices.find((c) => c.id === 'openrouter')?.hasKey).toBe(false);
    expect(JSON.stringify(choices)).not.toContain('apiKey');
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
