/**
 * The cost meter: what Scout and the experts spent, as counts only. A row never holds
 * what was said, only who spent it, on which model, and how many tokens.
 * Contains UsageRow and the `usage.summary` params and result.
 */
import { z } from 'zod';

/** Who spent it: Scout or an expert. */
export const UsageSource = z.enum(['scout', 'expert']);
export type UsageSource = z.infer<typeof UsageSource>;

/** One provider's spend for one source over a period, e.g. Scout on OpenRouter today. */
export const UsageRow = z.object({
  source: UsageSource,
  providerId: z.string().min(1),
  /** The model used most recently in the period; a period can hold several. */
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /**
   * Dollars for the priced calls, or null when none was priced: an unknown model, or the
   * Claude sign-in, which is the person's plan and never shown as money.
   */
  costUsd: z.number().nonnegative().nullable(),
  /** Tokens from calls with no known price, so the card can say "price unknown". */
  unpricedTokens: z.number().int().nonnegative(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageSummaryParams = z.object({});
export const UsageSummaryResult = z.object({
  today: z.array(UsageRow),
  month: z.array(UsageRow),
  /** Today's priced dollars, the number the daily budget is checked against. */
  todayUsd: z.number().nonnegative(),
  budget: z.object({
    dailyUsd: z.number().positive().nullable(),
    /** True once today's priced spend reached the cap: proactive work waits for midnight. */
    spentOut: z.boolean(),
  }),
});
export type UsageSummaryResult = z.infer<typeof UsageSummaryResult>;
