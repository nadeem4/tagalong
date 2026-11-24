/**
 * What the Runs on controls read: the brain machine's name and where each app and expert runs.
 * Null on a one-machine setup (the brain is on this PC) or while the brain cannot say, so no
 * control shows and nothing is fetched. Changes arrive as `changed placements`. Contains useRunsOn
 * and RunsOnModel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const remote = card?.local === false;
  const [state, setState] = useState<PlacementsState | null>(null);

  const reload = useCallback(() => {
    bridge.placementsState().then(setState, () => setState(null));
  }, [bridge]);
  useEffect(() => {
    if (!remote) return undefined;
    reload();
    return bridge.onBrainChanged((what) => what === 'placements' && reload());
  }, [bridge, remote, reload]);

  const machine = remote ? card.host : undefined;
  return useMemo(() => {
    if (machine === undefined || state === null) return null;
    return {
      machine,
      state,
      set: (kind, id, choice, tryFirst) =>
        void bridge.setPlacement(kind, id, placeOf(choice, tryFirst, state.thisPc)).catch(reload),
    };
  }, [bridge, machine, state, reload]);
}
