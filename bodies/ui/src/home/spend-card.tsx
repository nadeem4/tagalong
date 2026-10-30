/**
 * Home's Spend card: what was spent today against the daily limit, and whether the limit
 * paused Scout for the day. The brain reports only these two numbers. Contains SpendCard.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { SpendToday } from '../host-bridge';
import type { TurnEvent } from '../shapes';

/** The events after which the day's spend is read again: a turn started or ended. */
function changesSpend(event: TurnEvent): boolean {
  return (
    event.type === 'turn.started' || event.type === 'turn.completed' || event.type === 'turn.error'
  );
}

function dollars(usd: number): string {
  return usd > 0 && usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

/** A cap as the person typed it: "$1", "$2.50". */
function cap(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * Home's Spend card. Read again whenever a turn starts or ends.
 */
export function SpendCard() {
  const bridge = useHostBridge();
  const [spend, setSpend] = useState<SpendToday | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    const read = bridge.usageSummary;
    if (read === undefined) return;
    read
      .call(bridge)
      .then((next) => {
        setFailed(false);
        setSpend(next);
      })
      .catch(() => setFailed(true));
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onTurnEvent((event) => {
      if (changesSpend(event)) refresh();
    });
  }, [bridge, refresh]);

  if (bridge.usageSummary === undefined) return null;
  const limit = spend?.limitUsd ?? null;
  const spentOut = spend !== null && limit !== null && spend.spentUsd >= limit;
  return (
    <section className="home-card" aria-label="Spend">
      <h2 className="home-card__label">SPEND</h2>
      {failed && spend === null && <p>Tagalong could not read what was spent.</p>}
      {spend !== null && (
        <>
          {spentOut && limit !== null && (
            <p className="home-card__lead">
              Today’s {cap(limit)} is spent; Scout pauses until midnight.
            </p>
          )}
          <h3 className="home-card__label">TODAY</h3>
          {spend.spentUsd === 0 ? (
            <p>Nothing spent yet today.</p>
          ) : (
            <p className="home-card__row">
              <span>
                {limit === null
                  ? dollars(spend.spentUsd)
                  : `${dollars(spend.spentUsd)} of ${cap(limit)}`}
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
