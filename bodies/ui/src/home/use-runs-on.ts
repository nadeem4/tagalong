/**
 * What the Runs on controls read: the brain machine's name and where each app and expert runs.
 * Null on a one-machine setup (the brain is on this PC) or while the brain cannot say, so no
 * control shows. Changes arrive as `changed placements`. Contains useRunsOn and RunsOnModel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import { placeOf, type PlacementsState, type RunsChoice, type TryFirst } from '../shapes';
import { useBrainCard } from './use-brain-card';

export interface RunsOnModel {
  machine: string;
  state: PlacementsState;
  set: (kind: 'app' | 'expert', id: string, choice: RunsChoice, tryFirst: TryFirst) => void;
}

export function useRunsOn(): RunsOnModel | null {
  const bridge = useHostBridge();
  const { card } = useBrainCard();
  const [state, setState] = useState<PlacementsState | null>(null);

  const reload = useCallback(() => {
    bridge.placementsState().then(setState, () => setState(null));
  }, [bridge]);
  useEffect(reload, [reload]);
  useEffect(
    () => bridge.onBrainChanged((what) => what === 'placements' && reload()),
    [bridge, reload],
  );

  if (card?.local !== false || card.host === undefined || state === null) return null;
  return {
    machine: card.host,
    state,
    set: (kind, id, choice, tryFirst) =>
      void bridge
        .setPlacement(kind, id, placeOf(choice, tryFirst, state.thisPc))
        .then(reload, reload),
  };
}
