/**
 * useKnowMe: what a window needs to run get to know me. It loads the sources once, listens to
 * the run's status from mount on (the first status can arrive before the start reply) and says
 * whether a run is going. Contains useKnowMe.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { KnowMeInput, KnowMeStatus, KnowSourceInfo } from '../shapes';

const NOT_CONNECTED = 'Scout is not connected right now.';

export interface KnowMe {
  sources: KnowSourceInfo[];
  status: KnowMeStatus | null;
  /** True from start until a status says done. */
  running: boolean;
  start(input: KnowMeInput): Promise<void>;
  /** A plain sentence when the brain refused the start or is away. */
  error: string | null;
}

export function useKnowMe(): KnowMe {
  const bridge = useHostBridge();
  const [sources, setSources] = useState<KnowSourceInfo[]>([]);
  const [status, setStatus] = useState<KnowMeStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded on mount and again whenever the brain says something changed, so a window opened
  // before the brain was up recovers by itself.
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      bridge
        .knowMeSources()
        .then((list) => {
          if (!alive) return;
          setSources(list);
          setError((prev) => (prev === NOT_CONNECTED ? null : prev));
        })
        .catch(() => alive && setError(NOT_CONNECTED));
    };
    load();
    const offChanged = bridge.onBrainChanged(load);
    return () => {
      alive = false;
      offChanged();
    };
  }, [bridge]);

  // Subscribed before any start, so the first status is never missed. A run another window
  // started shows here too.
  useEffect(() => {
    return bridge.onKnowMeStatus((next) => {
      setStatus(next);
      setRunning(!next.done);
    });
  }, [bridge]);

  const start = useCallback(
    async (input: KnowMeInput): Promise<void> => {
      setError(null);
      setStatus(null);
      setRunning(true);
      try {
        await bridge.knowMeStart(input);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Scout could not start.');
        setRunning(false);
      }
    },
    [bridge],
  );

  return { sources, status, running, start, error };
}
