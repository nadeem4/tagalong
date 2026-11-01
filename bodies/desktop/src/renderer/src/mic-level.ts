/**
 * The mic level meter's logic: frameLevel turns one frame into 0..1, watchLevel opens the mic,
 * feeds smoothed levels to a callback and always closes it. Nothing is recorded, kept or sent:
 * a frame is read for its loudness and dropped. Used by the walkthrough and Settings.
 */
import { micFailure } from './mic-failure';
import type { OpenMic } from './mic';

/** The quietest sound the bar shows; below this it reads empty. */
const FLOOR_DB = -60;
/** How much of the last level the bar keeps per frame, so it falls smoothly. */
const DECAY = 0.8;

/** Loudness of one frame, 0 (silence or -60 dB) to 1 (full scale), on a fixed dB window. */
export function frameLevel(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  const rms = Math.sqrt(sum / frame.length);
  if (rms === 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) - FLOOR_DB) / -FLOOR_DB));
}

export type MicWatchFailure = 'denied' | 'busy' | 'no-mic';

/**
 * Opens the mic and reports each frame's level, rising at once and falling smoothly. stop() (or
 * a failing stream) closes the mic exactly once; an open that fails reports why and does not throw.
 */
export function watchLevel(
  open: () => Promise<OpenMic>,
  onLevel: (level: number) => void,
  onError?: (reason: MicWatchFailure) => void,
): { stop(): void } {
  let stopped = false;
  let mic: OpenMic | null = null;
  let closed = false;
  const close = (): void => {
    if (closed || mic === null) return;
    closed = true;
    mic.close();
  };

  void (async () => {
    try {
      mic = await open();
    } catch (error) {
      if (!stopped) onError?.(micFailure(error));
      return;
    }
    // Stopped while it was still opening: close it without reading a frame.
    if (stopped) return close();
    let level = 0;
    try {
      for await (const frame of mic) {
        if (stopped) break;
        level = Math.max(frameLevel(frame), level * DECAY);
        onLevel(level);
      }
    } catch (error) {
      if (!stopped) onError?.(micFailure(error));
    } finally {
      close();
    }
  })();

  return {
    stop(): void {
      stopped = true;
      close();
    },
  };
}
