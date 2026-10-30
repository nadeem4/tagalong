/**
 * Puts `window.tagalongVoice` (ears, microphone, ears' models) on a window. The bubble
 * installs it before it renders.
 */
import type { Ears } from '@tagalong/ui/shapes';
import '../../shared/ipc';
import { openMic } from './mic';
import type { OpenMic } from './mic';
import { RemoteEars } from './remote-ears';

/** What any window can reach for voice: the ears, the microphone and the ears' models. */
export type TagalongVoice = {
  ears: Ears;
  openMic(deviceId?: string): Promise<OpenMic>;
  ensureEars(onProgress: (fraction: number) => void): Promise<void>;
};

declare global {
  interface Window {
    tagalongVoice: TagalongVoice;
  }
}

/** Installs the voice seam on a window. */
export function installVoiceSeam(target: Window = window): void {
  // A RemoteEars lets go of its handlers after a held question's turnEnd, so this long-lived
  // ears subscribes for good itself and hands only listen and stop to one RemoteEars.
  const remote = new RemoteEars(target.tagalongHost, 'held');
  const ears: Ears = {
    on: (event, handler) =>
      void target.tagalongHost.onEarsEvent((said, text) => {
        if (said === event) handler(text);
      }),
    listen: (mic) => remote.listen(mic),
    stop: () => remote.stop(),
  };
  target.tagalongVoice = {
    ears,
    openMic,
    ensureEars: (onProgress) => target.tagalongHost.ensureEars(onProgress),
  };
}
