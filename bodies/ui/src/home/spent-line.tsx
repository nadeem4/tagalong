/**
 * A single "Spent today: $0.42" line for the daily-limit controls (walkthrough step 8). It is a
 * nicety, so an unreadable spend renders nothing rather than an error. Contains SpentLine.
 */

import type { SpendToday } from '../host-bridge';
import type { TurnEvent } from '../shapes';
import { dollars } from './spend-format';
import { useSpentToday } from './use-spent-today';

export function SpentLine({
  read,
  onTurnEvent,
}: {
  read: () => Promise<SpendToday>;
  /** Pass the bridge's turn events to read again when a turn starts or ends. */
  onTurnEvent?: (handler: (event: TurnEvent) => void) => () => void;
}) {
  const spentUsd = useSpentToday(read, onTurnEvent);
  if (spentUsd === null) return null;
  return <p className="tg-spent">Spent today: {dollars(spentUsd)}</p>;
}
