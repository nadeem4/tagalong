/**
 * What a launch remembers and says: the clean-close marker, whether Scout can think right now, and
 * the launch line's brain mark. Contains recordLaunch, recordCleanClose, brainReadiness,
 * brainStatus and brainLine.
 */

import type { Pet, PickUpReadyParams, Settings, SettingsPatch, StatusId } from '@tagalong/protocol';
import type { ClaudeSignIn, GreetLine, ProviderChoice } from '../shared/ipc';

/** The slice of the settings store the launch record needs. */
export interface LaunchStore {
  get(): Settings;
  set(patch: SettingsPatch): Settings;
}

/** What the last launch left behind, read before this one overwrites it. */
export interface PreviousLaunch {
  /** It never recorded a clean close. */
  crashed: boolean;
  lastVersion: string | null;
}

/**
 * Called first thing at start: reads whether the last launch closed cleanly and which
 * version it ran, then marks this launch open on this version. A settings file that cannot
 * be read or written never stops the launch; it reads as a plain one.
 */
export function recordLaunch(store: LaunchStore, version: string): PreviousLaunch {
  try {
    const before = store.get();
    store.set({ closedCleanly: false, lastVersion: version });
    return { crashed: !before.closedCleanly, lastVersion: before.lastVersion };
  } catch (error) {
    console.warn('[main] could not record this launch:', error);
    return { crashed: false, lastVersion: null };
  }
}

/** A clean quit, or Windows ending the session: the next launch is not a crash. */
export function recordCleanClose(store: LaunchStore | null | undefined, now: Date): void {
  try {
    store?.set({ closedCleanly: true, lastClosedAt: now.toISOString() });
  } catch (error) {
    console.warn('[main] could not remember this quit:', error);
  }
}

/** Whether Scout can think right now, read without a model call. */
export type BrainReadiness = 'ready' | 'signed-out' | 'no-sign-in' | 'no-key' | 'unknown';

/** The sign-in check runs beside the greeting and gets no longer than this. */
export const SIGN_IN_BUDGET_MS = 1_000;

export async function brainReadiness(deps: {
  pet: Pet | undefined;
  providers: readonly ProviderChoice[];
  signIn: () => Promise<ClaudeSignIn>;
  budgetMs: number;
}): Promise<BrainReadiness> {
  const { pet, providers } = deps;
  if (pet === undefined) return 'unknown';
  if (pet.providerId !== 'claude-code') {
    const provider = providers.find((choice) => choice.id === pet.providerId);
    return provider?.needsKey === true && !provider.hasKey ? 'no-key' : 'ready';
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'unknown'>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), deps.budgetMs);
  });
  const state = await Promise.race([deps.signIn().catch(() => 'unknown' as const), late]);
  clearTimeout(timer);
  if (state === 'signed-in') return 'ready';
  if (state === 'signed-out') return 'signed-out';
  if (state === 'not-installed') return 'no-sign-in';
  return 'unknown';
}

/** The brain mark for a brain that cannot think; null when it can, or could not be checked. */
export function brainStatus(brain: BrainReadiness): StatusId | null {
  switch (brain) {
    case 'signed-out':
      return 'brain-signed-out';
    case 'no-sign-in':
      return 'brain-no-sign-in';
    case 'no-key':
      return 'brain-no-key';
    default:
      return null;
  }
}

/**
 * The brain's line, or, when Scout cannot think, a status mark (shown as a row with Fix it,
 * never spoken): the body never talks in Scout's voice.
 */
export function brainLine(
  brain: BrainReadiness,
  composed: string,
  pickUp?: PickUpReadyParams,
): GreetLine {
  const status = brainStatus(brain);
  if (status !== null) return { status };
  return pickUp === undefined ? { text: composed } : { text: composed, pickUp };
}
