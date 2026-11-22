/**
 * Lists Tagalong brains announcing themselves on the home network (mDNS). It returns names and
 * addresses only: a found brain is never trusted, because pairing still needs the link the
 * owner made on that brain, whose fingerprint the desktop then pins.
 */
import { Bonjour } from 'bonjour-service';

export interface Announcement {
  name: string;
  /** The service type as announced, e.g. `_tagalong._tcp`. */
  type: string;
  port: number;
  addresses: string[];
}

/** Starts browsing, calls `onUp` for each announcement, and returns the function that stops. */
export type BrowseFn = (onUp: (announcement: Announcement) => void) => () => void;

export interface FoundBrain {
  name: string;
  addr: string;
}

const DEFAULT_TIMEOUT_MS = 3000;

export function discoverBrains(opts: {
  browse: BrowseFn;
  timeoutMs?: number;
}): Promise<FoundBrain[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundBrain>();
    const stop = opts.browse(({ name, type, port, addresses }) => {
      const host = addresses[0];
      if (type !== '_tagalong._tcp' || port <= 0 || host === undefined) return;
      const addr = `${host}:${port}`;
      if (!found.has(addr)) found.set(addr, { name, addr });
    });
    setTimeout(() => {
      stop();
      resolve([...found.values()]);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
}

/** The real browse, on the machine's multicast DNS. */
export const bonjourBrowse: BrowseFn = (onUp) => {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'tagalong' }, (service) =>
    onUp({
      name: service.name,
      type: `_${service.type}._${service.protocol}`,
      port: service.port,
      addresses: service.addresses?.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? [],
    }),
  );
  return () => {
    browser.stop();
    bonjour.destroy();
  };
};
