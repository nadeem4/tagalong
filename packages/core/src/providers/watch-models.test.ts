/** Tests for watchModelsFor: the check model on each provider, and the pet overrides. */
import { describe, expect, it } from 'vitest';
import { NEMOTRON_VISION_MODEL } from './nebius-models';
import { NEMOTRON_NANO_MODEL, watchModelsFor } from './watch-models';

const base = { model: 'big-model', providerId: 'nebius' };

describe('watchModelsFor', () => {
  it('uses Nemotron 3 Nano on Token Factory, routing pictures to Nemotron Nano VL', () => {
    expect(watchModelsFor(base)).toEqual({
      model: NEMOTRON_NANO_MODEL,
      visionModel: NEMOTRON_VISION_MODEL,
    });
  });

  it('keeps the pet vision model when it names one', () => {
    expect(watchModelsFor({ ...base, visionModel: 'my-vl' }).visionModel).toBe('my-vl');
  });

  it('uses Claude Haiku on OpenRouter and on Anthropic', () => {
    expect(watchModelsFor({ ...base, providerId: 'openrouter' }).model).toBe(
      'anthropic/claude-haiku-4.5',
    );
    expect(watchModelsFor({ ...base, providerId: 'anthropic' }).model).toBe('claude-haiku-4-5');
  });

  it('uses the fake model under the fake provider', () => {
    expect(watchModelsFor({ ...base, providerId: 'fake' }).model).toBe('fake-model');
  });

  it("falls back to the pet's own model on a provider it does not know", () => {
    expect(watchModelsFor({ ...base, providerId: 'ollama' }).model).toBe('big-model');
  });

  it('lets the pet pick its own check model over every default', () => {
    expect(watchModelsFor({ ...base, watchModel: 'tiny' }).model).toBe('tiny');
  });
});
