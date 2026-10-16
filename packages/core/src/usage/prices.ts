/**
 * What a million tokens cost, by `providerId/model`, in US dollars.
 *
 * A small table on purpose: a model not in it has no price, and the Spend card then says
 * "price unknown" rather than guessing. The Claude sign-in (`claude-code`, as Scout's brain
 * or as an expert) is never priced: it is the person's plan, so it shows tokens only.
 * OpenRouter ids for the 5.5 family are left out, because their exact spelling could not be
 * checked.
 *
 * Prices last checked: 2026-10-15, against Anthropic's published first-party API rates.
 * OpenRouter passes Anthropic's rates through unchanged. Prompt-cache reads and writes are
 * not counted apart: a provider reports them inside its input tokens or not at all.
 */
export interface Price {
  inputPerM: number;
  outputPerM: number;
  /** A higher rate for the whole call once one prompt passes `overInputTokens`. */
  longPrompt?: { overInputTokens: number; inputPerM: number; outputPerM: number };
}

const PRICES: Readonly<Record<string, Price>> = {
  // The current family.
  'anthropic/claude-opus-5-5': { inputPerM: 4, outputPerM: 20 },
  'anthropic/claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 },
  'anthropic/claude-haiku-5-5': {
    inputPerM: 0.1,
    outputPerM: 0.5,
    longPrompt: { overInputTokens: 100_000, inputPerM: 0.5, outputPerM: 2.5 },
  },
  // The models Settings offers on an Anthropic key (ANTHROPIC_MODELS) and the role tiers.
  'anthropic/claude-opus-5': { inputPerM: 5, outputPerM: 25 },
  'anthropic/claude-sonnet-5': { inputPerM: 2, outputPerM: 10 },
  'anthropic/claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  // OpenRouter's fallback list and role tiers.
  'openrouter/anthropic/claude-opus-5': { inputPerM: 5, outputPerM: 25 },
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
  const long = price.longPrompt;
  const rate = long !== undefined && inputTokens > long.overInputTokens ? long : price;
  return (inputTokens * rate.inputPerM + outputTokens * rate.outputPerM) / 1_000_000;
}
