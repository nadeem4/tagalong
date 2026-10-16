/**
 * What the "How Scout thinks" card says, read from Scout itself (its provider and model),
 * never from `settings.providerId`, which the engine ignores. The chip always carries
 * words, so the state never rests on colour alone.
 * Contains scoutBrain and overviewStatus (Home's overview line).
 */
import { brainLabel } from '@tagalong/ui';
import type { Pet } from '@tagalong/protocol';
import type { ClaudeSignIn, ProviderChoice } from '../../../shared/ipc';

export interface ScoutBrain {
  /**
   * `no-sign-in`: Scout is on the Claude sign-in and Claude Code is not on this computer,
   * so the card asks for a key instead. `engine-down`: there is no Scout to read.
   */
  state: 'ready' | 'checking' | 'signed-out' | 'unknown' | 'no-sign-in' | 'no-key' | 'engine-down';
  title: string;
  help: string;
  chip: { text: string; tone: 'ok' | 'warn' | 'plain' } | null;
}

export function scoutBrain(
  pet: Pet | undefined,
  providers: readonly ProviderChoice[],
  signIn: ClaudeSignIn | null,
): ScoutBrain {
  if (pet === undefined) return { state: 'engine-down', title: '', help: '', chip: null };
  const provider = providers.find((choice) => choice.id === pet.providerId);
  const title = brainLabel(provider?.label ?? pet.providerId, pet.providerId, pet.model);

  if (pet.providerId === 'claude-code') {
    const help = 'Scout thinks through Claude Code on this computer. No key needed.';
    switch (signIn) {
      case 'signed-in':
        return { state: 'ready', title, help, chip: { text: 'Signed in', tone: 'ok' } };
      case 'signed-out':
        return {
          state: 'signed-out',
          title,
          help: "Claude Code is installed but not signed in, so Scout can't think. Run claude in a terminal and sign in.",
          chip: { text: 'Signed out', tone: 'warn' },
        };
      case 'not-installed':
        return { state: 'no-sign-in', title, help, chip: null };
      case 'unknown':
        return {
          state: 'unknown',
          title,
          help: 'Tagalong could not ask Claude Code whether it is signed in.',
          chip: { text: 'Couldn’t check', tone: 'warn' },
        };
      default:
        return { state: 'checking', title, help, chip: { text: 'Checking…', tone: 'plain' } };
    }
  }

  if (provider?.needsKey === true) {
    return provider.hasKey
      ? {
          state: 'ready',
          title,
          help: `Scout thinks through ${provider.label} with your API key.`,
          chip: { text: 'Key stored', tone: 'ok' },
        }
      : {
          state: 'no-key',
          title,
          help: `Scout has no ${provider.label} key, so it can't think. Add one under Advanced, API keys.`,
          chip: { text: 'No key', tone: 'warn' },
        };
  }
  return { state: 'ready', title, help: '', chip: null };
}

const NOT_READY: Partial<Record<ScoutBrain['state'], string>> = {
  'signed-out': 'Signed out of Claude Code',
  'no-sign-in': 'Claude Code is not installed',
  'no-key': 'No API key',
  unknown: 'Couldn’t check its sign-in',
  'engine-down': 'Not running',
};

/** Home's overview line: Ready, or what stops Scout thinking, or that sight is paused. */
export function overviewStatus(
  brain: ScoutBrain,
  sightPaused: boolean,
): { text: string; ok: boolean } {
  const problem = NOT_READY[brain.state];
  if (problem !== undefined) return { text: problem, ok: false };
  return sightPaused ? { text: 'Ready, sight paused', ok: false } : { text: 'Ready', ok: true };
}
