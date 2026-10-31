/**
 * The worker's hold on the offscreen page that owns the microphone. The page exists only while
 * the person is talking, so the mic is never open for any other reason; it starts capturing as
 * soon as it loads and sends its frames to the worker as messages.
 */
export interface OffscreenApi {
  exists(): Promise<boolean>;
  create(): Promise<void>;
  close(): Promise<void>;
}

export interface MicControl {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createMicControl(offscreen: OffscreenApi): MicControl {
  return {
    async start() {
      // A page left over from a worker that died mid-listen would be capturing already, with
      // nobody counting its frames; remake it so this listen owns it.
      if (await offscreen.exists()) await offscreen.close();
      await offscreen.create();
    },
    async stop() {
      if (await offscreen.exists()) await offscreen.close();
    },
  };
}

/** What the offscreen page tells the worker: a 512-sample frame, or that the mic would not open. */
export type MicMessage = { type: 'mic:frame'; pcm: number[] } | { type: 'mic:failed' };
