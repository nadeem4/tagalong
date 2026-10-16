/** Tests for watchModelsFor: the check model on each provider, and the pet override. */
import { describe, expect, it } from 'vitest';
import { watchModelsFor } from './watch-models';

const base = { model: 'big-model', providerId: 'openrouter' };

describe('watchModelsFor', () => {
  it('uses Claude Haiku on OpenRouter and on Anthropic', () => {
    expect(watchModelsFor(base)).toEqual({ model: 'anthropic/claude-haiku-4.5' });
    expect(watchModelsFor({ ...base, providerId: 'anthropic' })).toEqual({
      model: 'claude-haiku-4-5',
    });
  });

  it('uses the fake model under the fake provider', () => {
    expect(watchModelsFor({ ...base, providerId: 'fake' }).model).toBe('fake-model');
  });

  it("falls back to the pet's own model on a provider it does not know", () => {
    expect(watchModelsFor({ ...base, providerId: 'ollama' }).model).toBe('big-model');
    expect(watchModelsFor({ ...base, providerId: 'nebius' }).model).toBe('big-model');
  });

  it('lets the pet pick its own check model over every default', () => {
    expect(watchModelsFor({ ...base, watchModel: 'tiny' }).model).toBe('tiny');
  });
});
