/**
 * "Scout, what's wrong?": gatherHealth reads the health card's rows (connections, voice,
 * microphone) from host calls that already exist, each within a time budget, with no model
 * call. Used by the bubble (panel.tsx).
 */
import { chosenMouth } from '@tagalong/protocol';
import type { AppsList } from '@tagalong/protocol';
import type { HealthFacts } from '@tagalong/ui';
import type { HostView, VoiceModels } from '../../shared/ipc';

/** The calls the health check reads from: all of them exist for Home and Settings already. */
export interface HealthDeps {
  getHostView(): Promise<HostView>;
  listConnections(): Promise<AppsList>;
  listMicrophones(): Promise<{ id: string }[]>;
  voiceModels(): Promise<VoiceModels>;
  /** How long each read may take before it fails. */
  testBudgetMs: number;
}

/** Each check gets this long by default: every read is a quick local or brain call. */
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

/** Reads every row at once. Never throws. Never reads a key: only whether one is stored. */
export async function gatherHealth(deps: HealthDeps): Promise<HealthFacts> {
  // Every call gets the budget: one that hangs is `unknown` for its own row, never the card.
  const attempt = <T>(work: () => Promise<T>) =>
    within(work, deps.testBudgetMs, 'unknown' as const);
  const [view, connections, microphones, models] = await Promise.all([
    attempt(() => deps.getHostView()),
    attempt(() => deps.listConnections()),
    attempt(() => deps.listMicrophones()),
    attempt(() => deps.voiceModels()),
  ]);
  const settings = view === 'unknown' ? null : view.settings;
  const picked = settings?.voice.microphoneId;
  return {
    connections:
      connections === 'unknown'
        ? 'unknown'
        : connections.apps.map(({ name, status }) => ({ name, status })),
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
  };
}
