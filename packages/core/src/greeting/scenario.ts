/** Works out what happened since the last launch (launchScenario) from recorded facts. */
/**
 * What happened since Tagalong last ran, worked out from recorded facts alone, so the
 * launch line never guesses. One scenario per launch: an update matters most (an installer
 * ends a running tray app by force, so a crash over a new version is the update), then a
 * crash, then a pick-up (you are back after a long break, with something left half done),
 * then time away, which says less.
 */
export type LaunchScenario = 'normal' | 'away' | 'pickUp' | 'crash' | 'update';

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface LaunchFacts {
  /** The last launch never recorded a clean close. */
  crashed: boolean;
  /** The version the last launch ran; null when none was recorded. */
  lastVersion: string | null;
  version: string;
  now: Date;
  /** When the person was last with Tagalong; null when nothing was recorded. */
  awaySince: Date | null;
  /** A pick-up snapshot is ready: you are back after six hours, with something to pick up. */
  pickUpReady: boolean;
}

export function launchScenario(facts: LaunchFacts): LaunchScenario {
  if (facts.lastVersion !== null && facts.lastVersion !== facts.version) return 'update';
  if (facts.crashed) return 'crash';
  if (facts.pickUpReady) return 'pickUp';
  if (facts.awaySince !== null && facts.now.getTime() - facts.awaySince.getTime() >= DAY_MS) {
    return 'away';
  }
  return 'normal';
}
