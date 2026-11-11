/**
 * Today's spend in dollars, read once and again whenever a turn starts or ends. It is a nicety:
 * an unreadable spend stays null rather than raising. Shared by SpentLine and Settings' limit
 * field. Contains useSpentToday.
 */

import { useEffect, useRef, useState } from 'react';
import type { SpendToday } from '../host-bridge';
import type { TurnEvent } from '../shapes';
import { changesSpend } from './spend-format';

export function useSpentToday(
  read: () => Promise<SpendToday>,
  /** Pass the bridge's turn events to read again when a turn starts or ends. */
  onTurnEvent?: (handler: (event: TurnEvent) => void) => () => void,
): number | null {
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

  return spentUsd;
}
