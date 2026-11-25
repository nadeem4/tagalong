/**
 * The requests a remote brain has open on this PC, kept current from the host. Used by the bubble
 * card, Home's section and the dock tag.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NeedsYouItem } from '../shapes';
import { useHostBridge } from '../host-bridge';

export function useNeedsYou(): NeedsYouItem[] {
  const bridge = useHostBridge();
  const [items, setItems] = useState<NeedsYouItem[]>([]);
  useEffect(() => {
    let live = true;
    const stop = bridge.onNeedsYou(setItems);
    bridge.needsYouList().then(
      (first) => {
        if (live) setItems(first);
      },
      () => undefined,
    );
    return () => {
      live = false;
      stop();
    };
  }, [bridge]);
  return items;
}

/** Answering a request, the same way from the bubble and from Home: `act` says whether it worked. */
export function useNeedsActions() {
  const bridge = useHostBridge();
  const act = useCallback(
    (id: string): Promise<boolean> =>
      bridge.needsYouAct(id).then(
        () => true,
        () => false,
      ),
    [bridge],
  );
  const notNow = useCallback((id: string) => bridge.needsYouNotNow(id), [bridge]);
  return { act, notNow };
}
