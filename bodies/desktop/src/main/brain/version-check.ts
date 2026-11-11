/**
 * Decides what the desktop does when a brain says hello: nothing (current), restart it quietly,
 * ask the person, or tell them to restart it in their terminal. Pure, so the rules that keep
 * a brain alive (never kill a person's, never loop on restarts) are tested without a process.
 */

export type UpdateAction = 'current' | 'restart' | 'ask' | 'terminal';

export interface BuildId {
  version: string;
  build: string;
}

export interface UpdateFacts {
  /** Who started the brain; null when it could not say (an old brain has no brain_status). */
  startedBy: 'desktop' | 'person' | null;
  workRunning: boolean;
  /** One quiet restart per app run: a second mismatch means the restart did not fix it. */
  restartedThisRun: boolean;
}

export function decideUpdate(
  ours: BuildId,
  theirs: { version?: string | undefined; build?: string | undefined },
  facts: UpdateFacts,
): UpdateAction {
  // A missing version or build never equals ours, so an old brain is never current.
  if (theirs.version === ours.version && theirs.build === ours.build) return 'current';
  if (facts.startedBy === 'person') return 'terminal';
  if (facts.startedBy === null) return 'ask';
  if (facts.workRunning || facts.restartedThisRun) return 'ask';
  return 'restart';
}
