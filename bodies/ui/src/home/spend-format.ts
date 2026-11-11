/**
 * How a day's spend reads and when it is read again, shared by Home's Spend card and the
 * "Spent today" line and the daily-limit field so they never disagree. Contains dollars, cap and
 * changesSpend.
 */

import type { TurnEvent } from '../shapes';

/** Two decimals, or "under $0.01" for a real but sub-cent amount. */
export function dollars(usd: number): string {
  return usd > 0 && usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

/** A cap as the person typed it: "$1", "$2.50". */
export function cap(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/** The events after which the day's spend is read again: a turn started or ended. */
export function changesSpend(event: TurnEvent): boolean {
  return (
    event.type === 'turn.started' || event.type === 'turn.completed' || event.type === 'turn.error'
  );
}
