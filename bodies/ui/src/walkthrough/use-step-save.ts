/**
 * How a step with choices saves them: it registers its save here, and the footer's Next calls
 * it. Nothing is written before Next, so Back and Skip for now lose and change nothing.
 * Contains StepSaveContext, useStepSave and useWalkthroughSettings.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { WalkthroughHost, WalkthroughSettings } from './walkthrough-host';

export type Save = () => Promise<void>;

/** The shell's register function; steps rendered alone get a no-op. */
export const StepSaveContext = createContext<(save: Save | null) => void>(() => undefined);

/** Registers `save` as what Next runs for this step, and takes it back when the step goes. */
export function useStepSave(save: Save): void {
  const register = useContext(StepSaveContext);
  useEffect(() => {
    register(save);
    return () => register(null);
  });
}

/** The host's settings, read once when the step opens; null until they arrive or if they fail. */
export function useWalkthroughSettings(host: Pick<WalkthroughHost, 'getSettings'>): {
  settings: WalkthroughSettings | null;
  failed: boolean;
} {
  const [settings, setSettings] = useState<WalkthroughSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const { getSettings } = host;
  useEffect(() => {
    getSettings().then(setSettings, () => setFailed(true));
  }, [getSettings]);
  return { settings, failed };
}
