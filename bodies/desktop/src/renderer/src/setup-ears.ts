/**
 * Ears that listen all the time without the name, so every turn is an answer. Contains
 * setupEars, micFailure and the SetupListening state. micFailure is shared with talk-rules.ts;
 * setupEars has no caller since Welcome went.
 */
import { ListenController } from '@tagalong/ui';
import type { ListenMic } from '@tagalong/ui';
import type { Ears, ListenMode } from '@tagalong/protocol';
import type { EarsStatus } from '../../shared/ipc';

export type ListenFailure = 'no-mic' | 'denied' | 'busy' | 'model-failed';

/** 'off'; a fraction while the speech model downloads (mic still closed); null while the mic is open. */
export type SetupListening = 'off' | number | null;

/**
 * A refused permission reads as denied; a microphone another app holds as busy; anything
 * else as no microphone.
 */
export function micFailure(error: unknown): 'denied' | 'busy' | 'no-mic' {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'no-mic';
}

export interface SetupEarsDeps {
  ears(mode: ListenMode): Ears;
  openMic(): Promise<ListenMic>;
  ensureEars(onProgress: (fraction: number) => void): Promise<void>;
  onEarsStatus(handler: (status: EarsStatus) => void): () => void;
  onSystemVoice(listener: (speaking: boolean) => void): () => void;
  onHeard(text: string): void;
  onSpeechStart(): void;
  onState(state: SetupListening): void;
  onFailure(why: ListenFailure): void;
}

export interface SetupEars {
  start(): void;
  stop(): void;
  dispose(): void;
}

/**
 * Setup's ears: the shared ListenController listening all the time without the name, so
 * every turn is an answer. The speech model is ready before the mic opens, and the mic
 * closes on `stop` (and `dispose`), on any failure, and while the system voice speaks.
 */
export function setupEars(deps: SetupEarsDeps): SetupEars {
  const controller = new ListenController({
    ears: deps.ears,
    openMic: deps.openMic,
    needsName: false,
    onSpeechStart: deps.onSpeechStart,
    onPartial: () => undefined,
    onHeard: deps.onHeard,
    onNothingHeard: () => undefined,
    onMicFailed: (error) => fail(micFailure(error)),
    onStopListening: () => undefined,
    onDropped: () => undefined,
  });
  let on = false;
  // A download that ends after a stop belongs to an earlier start: it must not open the mic.
  let run = 0;

  const stop = (): void => {
    on = false;
    run += 1;
    // setAlways(false), never earsFailed(): that leaves always on, and the system voice
    // ending would open the mic again.
    controller.setAlways(false);
    deps.onState('off');
  };
  const fail = (why: ListenFailure): void => {
    if (!on) return;
    stop();
    deps.onFailure(why);
  };

  const offStatus = deps.onEarsStatus((status) => {
    if (status.status === 'failed') fail('model-failed');
  });
  const offSystemVoice = deps.onSystemVoice((speaking) => controller.setDeaf(speaking));

  return {
    start() {
      if (on) return;
      on = true;
      const mine = (run += 1);
      deps.onState(0);
      deps
        .ensureEars((fraction) => {
          if (run === mine) deps.onState(Math.min(fraction, 0.99));
        })
        .then(
          () => {
            if (run !== mine) return;
            deps.onState(null);
            controller.setAlways(true);
          },
          () => {
            if (run === mine) fail('model-failed');
          },
        );
    },
    stop,
    dispose() {
      stop();
      offStatus();
      offSystemVoice();
    },
  };
}
