import { IPC } from '../../shared/ipc';
import type { SpeakPreview } from '../../shared/ipc';
import type { ListenService } from '../voice/listen';
import type { VoiceService } from '../voice/voice';
import type { IpcHandle } from './handle';

export interface VoiceIpcDeps {
  voice: () => Pick<VoiceService, 'speak'>;
  listen: () => Pick<ListenService, 'prepare' | 'transcribe'>;
  /** Notes the window you are on, as the ask key does. */
  noteActiveWindow: () => Promise<unknown>;
}

/** Scout's voice, and Talk to Scout. */
export function registerVoiceIpc(handle: IpcHandle, deps: VoiceIpcDeps): void {
  // Only the line itself reaches a speech engine: never the screen or the conversation.
  handle(IPC.speak, (_event, text: string, preview?: SpeakPreview) =>
    deps.voice().speak(String(text), preview),
  );

  // Talk to Scout started: note the window you are on, as the ask key does (never the
  // selection: copying it would press keys while the talk key is held), and start loading
  // the speech model while the person talks.
  handle(IPC.prepareListening, async () => {
    const listen = deps.listen();
    await deps
      .noteActiveWindow()
      .catch((error: unknown) =>
        console.warn('[main] could not note the window for a spoken question', error),
      );
    return listen.prepare();
  });

  // The recording, as 16 kHz samples. Turned into text here and dropped: never sent, never kept.
  handle(IPC.transcribe, (_event, samples: Float32Array) =>
    deps.listen().transcribe(samples instanceof Float32Array ? samples : new Float32Array(samples)),
  );
}
