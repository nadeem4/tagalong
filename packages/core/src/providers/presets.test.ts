import { describe, expect, it } from 'vitest';
import { NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL } from './nebius-models';
import { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, openAiPreset } from './presets';

describe('OpenAI-compatible presets', () => {
  it('ships Nebius Token Factory and OpenRouter', () => {
    expect(Object.keys(OPENAI_COMPATIBLE_PRESETS).sort()).toEqual(['nebius', 'openrouter']);
  });

  it('points nebius at Token Factory with the Nemotron models', () => {
    const nebius = openAiPreset('nebius');
    expect(nebius?.baseURL).toBe('https://api.tokenfactory.nebius.com/v1/');
    expect(nebius?.envVar).toBe('NEBIUS_API_KEY');
    expect(nebius?.fallbackModels).toEqual([NEMOTRON_TEXT_MODEL, NEMOTRON_VISION_MODEL]);
    expect(nebius?.visionModels).toEqual([NEMOTRON_VISION_MODEL]);
  });

  it('points openrouter at OpenRouter and lets every model see', () => {
    const openrouter = openAiPreset('openrouter');
    expect(openrouter?.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(openrouter?.envVar).toBe('OPENROUTER_API_KEY');
    // OpenRouter fronts vision and text models alike; with Claude, one model does it all.
    expect(openrouter?.visionModels).toBeUndefined();
    expect(openrouter?.fallbackModels.length).toBeGreaterThan(0);
  });

  it('answers undefined for a provider that is not a preset', () => {
    expect(openAiPreset('anthropic')).toBeUndefined();
    expect(openAiPreset('toString')).toBeUndefined();
  });

  it('files every key under its own SecretStore entry', () => {
    expect(SECRET_KEYS).toEqual({
      anthropic: 'anthropic.apiKey',
      nebius: 'nebius.apiKey',
      openrouter: 'openrouter.apiKey',
    });
  });
});
