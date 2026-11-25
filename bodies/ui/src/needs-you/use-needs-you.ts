/**
 * The requests a remote brain has open on this PC, kept current from the host. Used by the bubble
 * card, Home's section and the dock tag.
 */
import { useEffect, useState } from 'react';
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
