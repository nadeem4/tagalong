import type { Settings } from '@tagalong/protocol';
import { Info, Section, Tip, useInvalid } from './section';

/**
 * A daily cap on priced spend. Off (blank) by default. Once today's priced dollars reach
 * it, keep-an-eye comments and scheduled routines wait until midnight; asking Scout never.
 */
export function BudgetSection({ settings }: { settings: Settings }) {
  const invalid = useInvalid('dailyBudget');
  const value = settings.budget.dailyUsd;
  return (
    <Section id="budget">
      <div className="tg-labelrow">
        <label htmlFor={invalid.props.id}>Dollars a day (blank for no cap)</label>
        <Info tip="budget" label="About the daily budget" />
      </div>
      <input
        name="dailyBudget"
        inputMode="decimal"
        placeholder="No cap"
        defaultValue={value === null ? '' : String(value)}
        {...invalid.props}
      />
      {invalid.message}
      <Tip tip="budget">
        Once today&apos;s priced spend reaches this, Scout&apos;s comments while keeping an eye on
        things and scheduled routines stop until midnight. Asking Scout, Run now, watches you start
        and hand-offs you send always go through. Only models with a known price count, so on your
        Claude sign-in alone the cap never trips: that is your plan, not money. Home shows what was
        spent.
      </Tip>
    </Section>
  );
}
