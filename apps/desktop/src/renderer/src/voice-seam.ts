import type { Ears, MicStream } from '@tagalong/protocol';
import '../../shared/ipc';
import { openMic } from './mic';
import { RemoteEars } from './remote-ears';

/** What any window can reach for voice: the ears, the microphone and the ears' models. */
export type TagalongVoice = {
  ears: Ears;
  openMic(deviceId?: string): Promise<MicStream>;
  ensureEars(onProgress: (fraction: number) => void): Promise<void>;
};

declare global {
  interface Window {
    tagalongVoice: TagalongVoice;
  }
}

/** Puts `window.tagalongVoice` on a window; the first-run window will call it too. */
export function installVoiceSeam(target: Window = window): void {
  target.tagalongVoice = {
    ears: new RemoteEars(target.tagalongHost, 'held'),
    openMic,
    ensureEars: (onProgress) => target.tagalongHost.ensureEars(onProgress),
  };
}
