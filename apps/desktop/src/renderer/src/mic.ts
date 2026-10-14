import { EARS_SAMPLE_RATE, Pushable } from '@tagalong/protocol';
import type { MicStream } from '@tagalong/protocol';
// Its own file, not a data: URL: the panel's CSP (default-src 'self') blocks data: worklets.
import workletUrl from './mic-worklet.js?url&no-inline';

/** About 30 s of frames waiting at most; a stalled reader drops the oldest. */
const MAX_WAITING = 940;

/**
 * The open microphone: its 16 kHz mono frames, one after another, until closed. Ending the
 * reading early closes it too. Nothing is recorded or kept.
 */
export type OpenMic = MicStream & { close(): void };

/**
 * Opens the microphone (the one picked in Settings, or the system default) with Chromium's
 * echo cancellation on, so Scout's own voice played in this window is not heard, and
 * delivers 16 kHz mono frames. Only on the talk key, the mic button or Always listening.
 */
export async function openMic(deviceId?: string): Promise<OpenMic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId !== undefined && deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext({ sampleRate: EARS_SAMPLE_RATE });
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw error;
  }
  const frames = new Pushable<Float32Array>(MAX_WAITING);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'tagalong-mic');
  node.port.onmessage = (event: MessageEvent<Float32Array>) => frames.push(event.data);
  // A worklet is only run while connected towards the speakers; silent, so nothing plays.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(context.destination);

  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    frames.end();
    node.port.onmessage = null;
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };
  return {
    close,
    [Symbol.asyncIterator]: () => {
      const reading = frames[Symbol.asyncIterator]();
      return {
        next: () => reading.next(),
        return: () => {
          close();
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    },
  };
}

/** The microphones on this computer, for Settings. Names appear once one has been used. */
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
}
