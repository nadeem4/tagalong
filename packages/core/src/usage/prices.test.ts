import { describe, expect, it } from 'vitest';
import { costUsd, priceFor } from './prices';

describe('priceFor', () => {
  it('knows the current Claude family at Anthropic’s published rates', () => {
    expect(priceFor('anthropic', 'claude-opus-5-5')).toMatchObject({
      inputPerM: 4,
      outputPerM: 20,
    });
    expect(priceFor('anthropic', 'claude-sonnet-5-5')).toMatchObject({
      inputPerM: 2,
      outputPerM: 10,
    });
    expect(priceFor('anthropic', 'claude-haiku-5-5')).toMatchObject({
      inputPerM: 0.1,
      outputPerM: 0.5,
    });
  });

  it('knows every model the app offers on the Anthropic key and as OpenRouter fallbacks', () => {
    expect(priceFor('anthropic', 'claude-opus-5')).toEqual({ inputPerM: 5, outputPerM: 25 });
    expect(priceFor('anthropic', 'claude-sonnet-5')).toEqual({ inputPerM: 2, outputPerM: 10 });
    expect(priceFor('anthropic', 'claude-haiku-4-5')).toEqual({ inputPerM: 1, outputPerM: 5 });
    expect(priceFor('openrouter', 'anthropic/claude-opus-5')).toEqual({
      inputPerM: 5,
      outputPerM: 25,
    });
    expect(priceFor('openrouter', 'anthropic/claude-sonnet-5')).toEqual({
      inputPerM: 2,
      outputPerM: 10,
    });
    expect(priceFor('openrouter', 'anthropic/claude-haiku-4.5')).toEqual({
      inputPerM: 1,
      outputPerM: 5,
    });
  });

  it('has no price for a model it does not know: it never guesses', () => {
    expect(priceFor('openrouter', 'some/new-model')).toBeNull();
    expect(priceFor('nebius', 'nvidia/nemotron-3-super-120b-a12b')).toBeNull();
    // A made-up id that only looks like a real one.
    expect(priceFor('anthropic', 'claude-opus-5-5-20260401')).toBeNull();
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
    // 1M in at $4 + 1M out at $20.
    expect(costUsd('anthropic', 'claude-opus-5-5', 1_000_000, 1_000_000)).toBeCloseTo(24, 10);
  });

  it('charges Haiku 5.5’s higher rate once one call’s prompt passes 100k tokens', () => {
    // Up to 100k: $0.10 in, $0.50 out.
    expect(costUsd('anthropic', 'claude-haiku-5-5', 100_000, 10_000)).toBeCloseTo(0.015, 10);
    // Beyond: $0.50 in, $2.50 out, for the whole call.
    expect(costUsd('anthropic', 'claude-haiku-5-5', 200_000, 10_000)).toBeCloseTo(0.125, 10);
  });

  it('is null when the model has no price', () => {
    expect(costUsd('openrouter', 'some/new-model', 1000, 100)).toBeNull();
    expect(costUsd('claude-code', 'sonnet', 1000, 100)).toBeNull();
  });
});
