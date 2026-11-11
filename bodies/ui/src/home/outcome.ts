/**
 * How an add ended, kept per row so the words sit beside the thing the person pressed instead of
 * in a line at the top of the page. Contains Outcome and useOutcomes.
 */
import { useState } from 'react';

export interface Outcome {
  text: string;
  error: boolean;
  /** True when the thing was added: its button is replaced by the words. Otherwise the button stays. */
  added: boolean;
}

export function useOutcomes() {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());
  /** Runs an add and files its outcome under the row's id. */
  const track = async (id: string, call: Promise<Outcome | null>): Promise<void> => {
    const outcome = await call;
    setOutcomes((now) => {
      const next = new Map(now);
      if (outcome === null) next.delete(id);
      else next.set(id, outcome);
      return next;
    });
  };
  const clear = (): void => setOutcomes(new Map());
  return { outcomes, track, clear };
}
