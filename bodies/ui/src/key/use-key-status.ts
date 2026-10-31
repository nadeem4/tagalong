/**
 * useKeyStatus: the brain's key facts for a window, read on mount and again whenever the brain
 * says the key, its settings or the link changed. Contains useKeyStatus and KeyHost. A failed
 * read is `'offline'` (no brain to ask), not an error to show.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HostBridge, KeyStatus } from '../host-bridge';

/** The host calls the key field and its status need. */
export type KeyHost = Pick<HostBridge, 'keyStatus' | 'setKey' | 'onBrainChanged'>;

/** The `changed` names after which the key facts (and the daily limit beside them) are read again. */
const REFRESH_ON = new Set(['key', 'settings', 'spend_today', 'link']);

export function useKeyStatus(host: Pick<KeyHost, 'keyStatus' | 'onBrainChanged'>): {
  status: KeyStatus | 'offline' | null;
  refresh(): void;
} {
  const [status, setStatus] = useState<KeyStatus | 'offline' | null>(null);
  const { keyStatus, onBrainChanged } = host;

  const refresh = useCallback(() => {
    keyStatus().then(setStatus, () => setStatus('offline'));
  }, [keyStatus]);

  useEffect(() => {
    refresh();
    return onBrainChanged((what) => {
      if (REFRESH_ON.has(what)) refresh();
    });
  }, [refresh, onBrainChanged]);

  return { status, refresh };
}
