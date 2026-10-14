/**
 * What happened since Tagalong last ran, worked out from recorded facts alone, so the
 * launch line never guesses. One scenario per launch: a crash matters most, then an
 * update, then time away.
 */
export type LaunchScenario = 'normal' | 'away' | 'crash' | 'update';

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
}

export function launchScenario(facts: LaunchFacts): LaunchScenario {
  if (facts.crashed) return 'crash';
  if (facts.lastVersion !== null && facts.lastVersion !== facts.version) return 'update';
  if (facts.awaySince !== null && facts.now.getTime() - facts.awaySince.getTime() >= DAY_MS) {
    return 'away';
  }
  return 'normal';
}
