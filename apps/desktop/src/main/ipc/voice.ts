import { addressedToScout, isStopListening } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { SpeakPreview } from '../../shared/ipc';
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
}

/** Scout's voice, and its ears: the mic's frames pass through main to the voice process. */
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
}

/**
 * What the ears say goes to the windows; a dead voice process is said plainly. `onSpoken`
 * hears words addressed to Scout, so the bubble can come up: never bare speech, never talk
 * that does not start with the name, and never "Scout, stop", which only switches listening off.
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
      if (onSpoken !== undefined && question !== null && !isStopListening(question)) onSpoken();
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
