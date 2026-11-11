/**
 * Reads Scout's brain card and the first-run setup state from the host, and reads them again
 * when the brain says the link or its jobs changed. Shared by the card and the update banner.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge, type BrainCard, type BrainLink } from '../host-bridge';

export function useBrainCard(): { card: BrainCard | null; setup: BrainLink['setup'] } {
  const bridge = useHostBridge();
  const [card, setCard] = useState<BrainCard | null>(null);
  const [setup, setSetup] = useState<BrainLink['setup']>('idle');

  const refresh = useCallback(() => {
    void bridge.brainCard().then(setCard, () => undefined);
    void bridge.brainLink().then(
      (link) => setSetup(link.setup),
      () => undefined,
    );
  }, [bridge]);

  useEffect(() => {
    refresh();
    // The link going up or down, a job starting or ending (which Restart now depends on), and
    // the model being picked in Settings.
    return bridge.onBrainChanged((what) => {
      if (what === 'link' || what === 'jobs' || what === 'model') refresh();
    });
  }, [bridge, refresh]);

  return { card, setup };
}
