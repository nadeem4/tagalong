/** Tests for the usage.summary method. */
import { describe, expect, it } from 'vitest';
import { hostToCoreMethods, paramsSchemaFor, resultSchemaFor } from './methods';
import { UsageSummaryParams, UsageSummaryResult } from './usage';

const row = {
  source: 'scout',
  providerId: 'openrouter',
  model: 'anthropic/claude-haiku-4.5',
  inputTokens: 1200,
  outputTokens: 300,
  costUsd: 0.0027,
  unpricedTokens: 0,
} as const;

const empty = { today: [], month: [], todayUsd: 0, budget: { dailyUsd: null, spentOut: false } };

describe('usage.summary', () => {
  it('takes no params', () => {
    expect(UsageSummaryParams.parse({})).toEqual({});
  });

  it('carries today, this month, the priced spend and the cap', () => {
    const result = {
      today: [row],
      month: [row, { ...row, source: 'expert', providerId: 'claude-code', costUsd: null }],
      todayUsd: 0.0027,
      budget: { dailyUsd: 1, spentOut: false },
    };
    expect(UsageSummaryResult.parse(result)).toEqual(result);
  });

  it('refuses a source other than Scout or an expert, and negative tokens', () => {
    expect(
      UsageSummaryResult.safeParse({ ...empty, today: [{ ...row, source: 'x' }] }).success,
    ).toBe(false);
    expect(
      UsageSummaryResult.safeParse({ ...empty, today: [{ ...row, inputTokens: -1 }] }).success,
    ).toBe(false);
  });

  it('is a host-to-core method', () => {
    expect(hostToCoreMethods['usage.summary'].params).toBe(UsageSummaryParams);
    expect(hostToCoreMethods['usage.summary'].result).toBe(UsageSummaryResult);
    expect(paramsSchemaFor('usage.summary').parse({})).toEqual({});
    expect(resultSchemaFor('usage.summary').parse(empty)).toEqual(empty);
  });
});
