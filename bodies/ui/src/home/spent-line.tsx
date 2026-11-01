/**
 * A single "Spent today: $0.42" line for the daily-limit controls (walkthrough step 8 and
 * Settings). It is a nicety, so an unreadable spend renders nothing rather than an error.
 * Contains SpentLine.
 */

import { useEffect, useRef, useState } from 'react';
import type { SpendToday } from '../host-bridge';
import type { TurnEvent } from '../shapes';
import { changesSpend, dollars } from './spend-format';

export function SpentLine({
  read,
  onTurnEvent,
}: {
  read: () => Promise<SpendToday>;
  /** Pass the bridge's turn events to read again when a turn starts or ends. */
  onTurnEvent?: (handler: (event: TurnEvent) => void) => () => void;
}) {
  const [spentUsd, setSpentUsd] = useState<number | null>(null);

  // Reads can resolve out of order; only the newest request may set the amount.
  const latest = useRef(0);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      const mine = ++latest.current;
      return read().then(
        (next) => live && mine === latest.current && setSpentUsd(next.spentUsd),
        () => undefined,
      );
    };
    void refresh();
    const stop = onTurnEvent?.((event) => {
      if (changesSpend(event)) void refresh();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [read, onTurnEvent]);

  if (spentUsd === null) return null;
  return <p className="tg-spent">Spent today: {dollars(spentUsd)}</p>;
}
