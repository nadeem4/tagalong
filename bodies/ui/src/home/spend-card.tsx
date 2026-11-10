/**
 * Home's Spend card: what was spent today against the daily limit, and whether the limit
 * paused Scout for the day. The brain reports only these two numbers. Contains SpendCard.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { SpendToday } from '../host-bridge';
import { changesSpend, dollars } from './spend-format';

/** A cap as the person typed it: "$1", "$2.50". */
function cap(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * Home's Spend card. Read again whenever a turn starts or ends, and when the brain connection changes.
 */
export function SpendCard() {
  const bridge = useHostBridge();
  const [spend, setSpend] = useState<SpendToday | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    bridge
      .usageSummary()
      .then((next) => {
        setFailed(false);
        setSpend(next);
      })
      .catch(() => setFailed(true));
  }, [bridge]);

  useEffect(() => {
    refresh();
    const stopTurn = bridge.onTurnEvent((event) => {
      if (changesSpend(event)) refresh();
    });
    // A failed read while the brain was down must not outlive the outage.
    const stopBrain = bridge.onBrainChanged((what) => {
      if (what === 'link') refresh();
    });
    return () => {
      stopTurn();
      stopBrain();
    };
  }, [bridge, refresh]);

  const limit = spend?.limitUsd ?? null;
  const spentOut = spend !== null && limit !== null && spend.spentUsd >= limit;
  return (
    <section className="home-card" aria-label="Spend">
      <h2 className="home-card__label">Spend</h2>
      {failed && spend === null && <p>Tagalong could not read what was spent.</p>}
      {spend !== null && (
        <>
          {spentOut && limit !== null && (
            <p className="home-card__lead">
              Today’s {cap(limit)} is spent; Scout pauses until midnight.
            </p>
          )}
          <h3 className="home-card__label">Today</h3>
          {spend.spentUsd === 0 ? (
            <p>Nothing spent yet today.</p>
          ) : (
            <p className="home-spend">
              {limit === null
                ? dollars(spend.spentUsd)
                : `${dollars(spend.spentUsd)} of ${cap(limit)}`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
