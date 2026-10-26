/**
 * Fails open turns when the brain stays down. A short blip is covered by the client's own
 * resync on reconnect; if the brain does not come back, the bubble must not stream forever.
 */
import type { BrainStatus } from './brain-client';

export function offlineWatch(giveUp: () => void, ms = 10_000): (status: BrainStatus) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (status) => {
    if (status === 'offline') {
      // Reconnect attempts flip connecting/offline; the first offline sets the deadline.
      timer ??= setTimeout(() => {
        timer = undefined;
        giveUp();
      }, ms);
    } else if (status === 'online') {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
