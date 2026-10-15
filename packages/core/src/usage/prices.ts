/**
 * What a million tokens cost, by `providerId/model`, in US dollars.
 *
 * A small table on purpose: a model not in it has no price, and the Spend card then says
 * "price unknown" rather than guessing. The Claude sign-in (`claude-code`, as Scout's brain
 * or as an expert) is never priced: it is the person's plan, so it shows tokens only.
 * Token Factory's Nemotron models are left out because their prices could not be checked.
 *
 * Prices last checked: 2026-10-15, against Anthropic's published API rates. OpenRouter
 * passes Anthropic's rates through unchanged.
 */
export interface Price {
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Readonly<Record<string, Price>> = {
  'anthropic/claude-opus-5': { inputPerM: 5, outputPerM: 25 },
  'anthropic/claude-sonnet-5': { inputPerM: 2, outputPerM: 10 },
  'anthropic/claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  'openrouter/anthropic/claude-sonnet-5': { inputPerM: 2, outputPerM: 10 },
  'openrouter/anthropic/claude-haiku-4.5': { inputPerM: 1, outputPerM: 5 },
};

/** The price of one model, or null when it is unknown or on the person's plan. */
export function priceFor(providerId: string, model: string): Price | null {
  const key = `${providerId}/${model}`;
  return Object.hasOwn(PRICES, key) ? PRICES[key]! : null;
}

/** Dollars for one call, or null when the model has no price. */
export function costUsd(
  providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = priceFor(providerId, model);
  if (price === null) return null;
  return (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000;
}
