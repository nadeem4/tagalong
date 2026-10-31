/**
 * The walkthrough's nine steps (the side list) and what Skip tour does. Contains STEPS,
 * KEY_STEP and skipTour.
 */

export interface StepInfo {
  id: number;
  /** The short name in the side list. */
  title: string;
  /** Every step but the key can be skipped. */
  skippable: boolean;
}

export const STEPS: readonly StepInfo[] = [
  { id: 1, title: 'Welcome', skippable: true },
  { id: 2, title: 'How it fits', skippable: true },
  { id: 3, title: 'What to ask', skippable: true },
  { id: 4, title: 'Asking', skippable: true },
  { id: 5, title: 'Voice', skippable: true },
  { id: 6, title: 'Experts', skippable: true },
  { id: 7, title: 'Browser', skippable: true },
  { id: 8, title: 'You’re in charge', skippable: true },
  { id: 9, title: 'API key', skippable: false },
];

/** The last step, where the key is asked for. */
export const KEY_STEP = 9;

/** With a key Skip tour leaves; without one it jumps to the key, which cannot be skipped. */
export function skipTour(hasKey: boolean): 'close' | { goTo: number } {
  return hasKey ? 'close' : { goTo: KEY_STEP };
}
