/** Tests for the OpenAI-compatible presets and where each provider key is filed. */
import { describe, expect, it } from 'vitest';
import { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, openAiPreset } from './presets';

describe('OpenAI-compatible presets', () => {
  it('ships OpenRouter only', () => {
    expect(Object.keys(OPENAI_COMPATIBLE_PRESETS)).toEqual(['openrouter']);
  });

  it('points openrouter at OpenRouter', () => {
    const openrouter = openAiPreset('openrouter');
    expect(openrouter?.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(openrouter?.envVar).toBe('OPENROUTER_API_KEY');
    expect(openrouter?.fallbackModels.length).toBeGreaterThan(0);
  });

  it('offers no NVIDIA model among the OpenRouter fallbacks', () => {
    expect(openAiPreset('openrouter')?.fallbackModels.some((id) => id.startsWith('nvidia/'))).toBe(
      false,
    );
  });

  it('answers undefined for a provider that is not a preset', () => {
    expect(openAiPreset('anthropic')).toBeUndefined();
    expect(openAiPreset('nebius')).toBeUndefined();
    expect(openAiPreset('toString')).toBeUndefined();
  });

  it('files every key under its own SecretStore entry', () => {
    expect(SECRET_KEYS).toEqual({
      anthropic: 'anthropic.apiKey',
      openrouter: 'openrouter.apiKey',
    });
  });
});
