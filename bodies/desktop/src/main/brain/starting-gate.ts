/**
 * Numbers each brain launch so a stale one cannot end "Starting" for a newer one: an update
 * restart relaunches while the old child's exit may still arrive. Pure; no I/O.
 */

/** `next()` starts a launch and returns its callback; only the latest launch's `false` counts. */
export function startingGate(report: (on: boolean) => void): {
  next: () => (on: boolean) => void;
} {
  let current = 0;
  return {
    next: () => {
      const gen = ++current;
      return (on) => {
        if (on || gen === current) report(on);
      };
    },
  };
}
