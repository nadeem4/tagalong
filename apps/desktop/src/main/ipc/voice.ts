/**
 * IPC for Scout's voice and ears: speaking a line, the microphone's frames on their way to the
 * voice process, Always listening and the model check. Contains registerVoiceIpc and forwardEars.
 */

import { addressedToScout, isStopListening, mightBeStop } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { SpeakPreview, VoiceModels } from '../../shared/ipc';
import { EARS_FILES, filesPresent } from '../voice/ears/model-files';
import { kokoroDownloaded } from '../voice/kokoro';
import type { AlwaysListening } from '../always-listening';
import type { VoiceWorker } from '../voice/worker/client';
import type { VoiceService } from '../voice/voice';
import type { IpcHandle, IpcOn } from './handle';

export interface VoiceIpcDeps {
  voice: () => Pick<VoiceService, 'speak'>;
  worker: () => Pick<VoiceWorker, 'send' | 'call'>;
  /** Notes the window you are on, as the ask key does. */
  noteActiveWindow: () => Promise<unknown>;
  /** Always listening: only the person switches it, from the bubble. */
  listening: () => Pick<AlwaysListening, 'state' | 'set'>;
  on: IpcOn;
  /** The voice models' folder, for the health check's look on disk. */
  voiceDir?: () => string;
}

export function registerVoiceIpc(handle: IpcHandle, deps: VoiceIpcDeps): void {
  // Only the line itself reaches a speech engine: never the screen or the conversation.
  handle(IPC.speak, (_event, text: string, preview?: SpeakPreview) =>
    deps.voice().speak(String(text), preview),
  );

  // Frames and stop wait for a listen still noting the window, so the voice process hears
  // them in the order the panel sent them. A failed step does not hold up the next.
  let queue: Promise<void> = Promise.resolve();
  const inOrder = (step: () => void | Promise<void>): Promise<void> => {
    const next = queue.then(step);
    queue = next.catch(() => undefined);
    return next;
  };

  // A held question notes the window you are on, as the ask key does (never the selection:
  // copying it would press keys while the talk key is held).
  handle(IPC.earsListen, (_event, mode: string) => {
    if (mode !== 'held' && mode !== 'always') {
      throw new Error(`Unknown listening mode: ${String(mode)}`);
    }
    const noted =
      mode === 'held'
        ? deps
            .noteActiveWindow()
            .then(() => undefined)
            .catch((error: unknown) =>
              console.warn('[main] could not note the window for a spoken question', error),
            )
        : Promise.resolve();
    return inOrder(async () => {
      await noted;
      deps.worker().send({ kind: 'ears.listen', mode });
    });
  });

  // 16 kHz samples, a frame at a time. Handed to the voice process and never kept here.
  deps.on(IPC.micFrame, (_event, samples: Float32Array) => {
    const frame = samples instanceof Float32Array ? samples : new Float32Array(samples);
    inOrder(() => deps.worker().send({ kind: 'ears.frame', samples: frame })).catch(
      (error: unknown) =>
        console.warn('[main] a mic frame could not reach the voice process', error),
    );
  });

  handle(IPC.earsStop, () => inOrder(() => deps.worker().send({ kind: 'ears.stop' })));

  handle(IPC.getListening, () => deps.listening().state);
  handle(IPC.setListening, (_event, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Always listening is on or off.');
    return deps.listening().set(on);
  });

  // A download, not a listening step: it stays out of the ordering queue. Progress comes back
  // through forwardEars as IPC.earsProgressEvent.
  handle(IPC.ensureEars, async () => {
    await deps.worker().call({ kind: 'call', method: 'ears.ensure' });
  });

  // The health check: a look on disk for each model, never a download or a voice process.
  const voiceDir = deps.voiceDir;
  if (voiceDir !== undefined) {
    handle(IPC.voiceModels, (): VoiceModels => {
      const dir = voiceDir();
      return { mouth: kokoroDownloaded(dir), ears: filesPresent(dir, EARS_FILES) };
    });
  }
}

/**
 * What the ears say goes to the windows; a dead voice process is said plainly. `onSpoken`
 * hears words addressed to Scout, so the bubble can come up: never bare speech, never talk
 * that does not start with the name, and never "Scout, stop", which only switches listening off
 * (nor a partial such as "Scout, st" that may still become it).
 */
export function forwardEars(
  worker: Pick<VoiceWorker, 'onMessage' | 'onExit'>,
  send: (channel: string, payload: unknown) => void,
  onSpoken?: () => void,
): void {
  worker.onMessage((message) => {
    if (message.kind === 'ears') {
      const question =
        (message.event === 'partial' || message.event === 'turnEnd') && message.text !== undefined
          ? addressedToScout(message.text)
          : null;
      // A partial "Scout, st" may still become "stop": not a question until it cannot.
      const stop =
        question !== null &&
        (message.event === 'partial' ? mightBeStop(question) : isStopListening(question));
      if (onSpoken !== undefined && question !== null && !stop) onSpoken();
      send(
        IPC.earsEvent,
        message.text === undefined
          ? { event: message.event }
          : { event: message.event, text: message.text },
      );
    } else if (message.kind === 'ears.progress') {
      send(IPC.earsProgressEvent, { fraction: message.fraction });
    } else if (message.kind === 'ears.status') {
      send(
        IPC.earsStatusEvent,
        message.message === undefined
          ? { status: message.status }
          : { status: message.status, message: message.message },
      );
    }
  });
  worker.onExit(() =>
    send(IPC.earsStatusEvent, {
      status: 'failed',
      message: 'Listening stopped unexpectedly. Try again.',
    }),
  );
}
