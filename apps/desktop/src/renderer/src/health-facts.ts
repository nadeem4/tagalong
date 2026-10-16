/**
 * "Scout, what's wrong?": gatherHealth reads the health card's rows (brain and sign-in,
 * experts, connections, voice, microphone, browser extension) from host calls that already
 * exist, each within a time budget, with no model call. Used by the bubble (panel.tsx).
 */
import { chosenMouth } from '@tagalong/protocol';
import type { ConnectionsListResult, Expert } from '@tagalong/protocol';
import type { HealthFacts } from '@tagalong/ui';
import type { ClaudeSignIn, HostView, VoiceModels } from '../../shared/ipc';
import { scoutBrain } from './settings/brain';

/** The calls the health check reads from: all of them exist for Home and Settings already. */
export interface HealthDeps {
  getHostView(): Promise<HostView>;
  checkClaudeSignIn(): Promise<ClaudeSignIn>;
  listExperts(): Promise<Expert[]>;
  testExpert(expertId: string): Promise<{ ok: boolean }>;
  listConnections(): Promise<ConnectionsListResult>;
  listMicrophones(): Promise<{ id: string }[]>;
  voiceModels(): Promise<VoiceModels>;
  hostsStatus(): Promise<{ extension: boolean }>;
  /** How long each call (one expert's test, the sign-in, every read) may take before it fails. */
  testBudgetMs: number;
}

/** Each check gets this long by default: `claude --version` and the sign-in are quick. */
export const HEALTH_TEST_BUDGET_MS = 5_000;

const LATE = Symbol('late');

/** `work`, or `fallback` when it fails or takes longer than `ms`. */
async function within<T, F>(work: () => Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    const result = await Promise.race([work(), late]);
    return result === LATE ? fallback : result;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function brainOf(
  view: HostView | 'unknown',
  deps: HealthDeps,
): Promise<HealthFacts['brain']> {
  if (view === 'unknown') return 'unknown';
  const scout = view.pets.find((pet) => pet.id === view.settings.defaultPetId) ?? view.pets[0];
  const signIn =
    scout?.providerId === 'claude-code'
      ? await within(() => deps.checkClaudeSignIn(), deps.testBudgetMs, 'unknown' as const)
      : null;
  const { state } = scoutBrain(scout, view.providers, signIn);
  return state === 'ready' || state === 'signed-out' || state === 'no-sign-in' || state === 'no-key'
    ? state
    : 'unknown';
}

async function expertsOf(deps: HealthDeps): Promise<HealthFacts['experts']> {
  const experts = await within(() => deps.listExperts(), deps.testBudgetMs, 'unknown' as const);
  if (experts === 'unknown') return 'unknown';
  return Promise.all(
    experts
      .filter((expert) => expert.enabled)
      .map(async (expert) => ({
        name: expert.name,
        ok: await within(
          async () => (await deps.testExpert(expert.id)).ok,
          deps.testBudgetMs,
          false,
        ),
      })),
  );
}

/** Reads every row at once. Never throws. Never reads a key: only whether one is stored. */
export async function gatherHealth(deps: HealthDeps): Promise<HealthFacts> {
  // Every call gets the budget: one that hangs is `unknown` for its own row, never the card.
  const attempt = <T>(work: () => Promise<T>) =>
    within(work, deps.testBudgetMs, 'unknown' as const);
  const [view, experts, connections, microphones, models, hosts] = await Promise.all([
    attempt(() => deps.getHostView()),
    expertsOf(deps),
    attempt(() => deps.listConnections()),
    attempt(() => deps.listMicrophones()),
    attempt(() => deps.voiceModels()),
    attempt(() => deps.hostsStatus()),
  ]);
  const brain = await brainOf(view, deps);
  const settings = view === 'unknown' ? null : view.settings;
  const picked = settings?.voice.microphoneId;
  return {
    brain,
    experts,
    connections:
      connections === 'unknown'
        ? 'unknown'
        : connections.connections.map(({ name, status }) => ({ name, status })),
    voice:
      view === 'unknown' || settings === null || models === 'unknown'
        ? 'unknown'
        : {
            enabled: settings.voice.enabled,
            mouth: chosenMouth(settings.voice),
            elevenLabsKey: view.elevenLabsKeyStored,
            mouthReady: models.mouth,
            // The ears matter once listening is on, or a microphone was picked for talking.
            earsUsed: settings.listening.always || picked !== undefined,
            earsReady: models.ears,
          },
    microphone:
      microphones === 'unknown'
        ? 'unknown'
        : {
            count: microphones.length,
            pickedMissing:
              picked !== undefined && !microphones.some((microphone) => microphone.id === picked),
          },
    extension: hosts === 'unknown' ? 'unknown' : hosts.extension,
  };
}
