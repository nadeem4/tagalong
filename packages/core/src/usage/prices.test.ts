import { describe, expect, it } from 'vitest';
import { costUsd, priceFor } from './prices';

describe('priceFor', () => {
  it('knows the Anthropic models and the OpenRouter fallbacks', () => {
    expect(priceFor('anthropic', 'claude-sonnet-5')).toEqual({ inputPerM: 2, outputPerM: 10 });
    expect(priceFor('openrouter', 'anthropic/claude-haiku-4.5')).toEqual({
      inputPerM: 1,
      outputPerM: 5,
    });
  });

  it('has no price for a model it does not know: it never guesses', () => {
    expect(priceFor('openrouter', 'some/new-model')).toBeNull();
    expect(priceFor('nebius', 'nvidia/nemotron-3-super-120b-a12b')).toBeNull();
  });

  it('has no price for the Claude sign-in: that is the person’s plan, not money', () => {
    expect(priceFor('claude-code', 'haiku')).toBeNull();
    expect(priceFor('claude-code', 'claude-sonnet-5')).toBeNull();
  });
});

describe('costUsd', () => {
  it('works out dollars per million tokens, input and output apart', () => {
    // 1M in at $5 + 200k out at $25 = $5 + $5.
    expect(costUsd('anthropic', 'claude-opus-5', 1_000_000, 200_000)).toBeCloseTo(10, 10);
    expect(costUsd('anthropic', 'claude-haiku-4-5', 1000, 100)).toBeCloseTo(0.0015, 10);
  });

  it('is null when the model has no price', () => {
    expect(costUsd('openrouter', 'some/new-model', 1000, 100)).toBeNull();
    expect(costUsd('claude-code', 'sonnet', 1000, 100)).toBeNull();
  });
});
