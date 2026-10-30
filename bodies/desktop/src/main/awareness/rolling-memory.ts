/**
 * Rolling memory: one small frame of every display, and the window list, every five seconds while
 * it is on. Opt-in, memory only, gone on quit. Contains RollingMemory, ROLLING_TICK_MS and
 * FRAME_LONG_SIDE.
 */

import { findCaptureBlock } from '../platform/exclusions';
import type { CaptureExclusions } from '@tagalong/protocol';
import type { Platform } from '../platform/index';
import { isSightPaused } from '../platform/sight-gate';
import type { Clock } from './clock';
import { FrameRing } from './frame-ring';
import type { StoredFrame } from './frame-ring';

/** One moment every five seconds. */
export const ROLLING_TICK_MS = 5_000;

/**
 * The long side of a remembered frame.
 *
 * Small on purpose. Memory is for "what was I doing", which a 640-pixel frame answers, and
 * ten minutes of full-resolution captures would be hundreds of megabytes of the user's
 * screen sitting in this process.
 */
export const FRAME_LONG_SIDE = 640;

/** The three reads a tick makes. Always the sight-gated platform in production. */
export type RollingMemoryPlatform = Pick<
  Platform,
  'captureDisplays' | 'listWindows' | 'getActiveWindow'
>;

export interface RollingMemoryOptions {
  platform: RollingMemoryPlatform;
  clock: Clock;
  /** Read per tick, so an edited exclusion list applies to the very next frame. */
  exclusions: () => CaptureExclusions;
  isPaused: () => boolean;
  /** Drives the avatar's recording dot. Called only when the answer changes. */
  onRecordingChange?: (recording: boolean) => void;
  log?: (message: string) => void;
}

export interface RollingMemorySettings {
  enabled: boolean;
  minutes: number;
}

/**
 * Rolling memory: the last few minutes of the desktop, in memory, opt-in.
 *
 * Every five seconds it photographs each display at 640 pixels and lists the windows, and
 * keeps that in a `FrameRing`. A frame is skipped while sight is paused or an excluded
 * application has focus, and pausing clears what was held: a pause is a promise that the
 * pet does not know what was on screen, and a buffer that survived it would break that.
 * Nothing is written to disk, and quitting drops it all.
 */
export class RollingMemory {
  readonly ring = new FrameRing(10 * 60_000);
  readonly #options: RollingMemoryOptions;
  #enabled = false;
  #paused = false;
  #timer: unknown = null;
  #ticking = false;
  #lastReported = false;

  constructor(options: RollingMemoryOptions) {
    this.#options = options;
    this.#paused = options.isPaused();
  }

  /** On, not paused. What the avatar dot shows. */
  get recording(): boolean {
    return this.#enabled && !this.#paused;
  }

  /** Applies saved settings. Called at boot and on every save; no restart needed. */
  configure(settings: RollingMemorySettings): void {
    this.ring.setWindow(settings.minutes * 60_000);
    this.#enabled = settings.enabled;
    if (!settings.enabled) this.ring.clear();
    this.#sync();
  }

  /** Called when the user pauses or resumes sight. */
  pauseChanged(paused: boolean): void {
    this.#paused = paused;
    if (paused) this.ring.clear();
    this.#sync();
  }

  /** On quit: stop the timer and drop every frame. */
  dispose(): void {
    this.#enabled = false;
    this.ring.clear();
    this.#sync();
  }

  /** One capture. Public so the host can take the first frame without waiting a tick. */
  async tick(): Promise<void> {
    if (!this.recording || this.#ticking) return;
    this.#ticking = true;
    const log = this.#options.log ?? (() => {});
    try {
      const { platform } = this.#options;
      const exclusions = this.#options.exclusions();
      // Asked before the picture is taken: an exclusion that only filtered the result
      // would already have photographed the password manager it promised not to.
      const active = await platform.getActiveWindow();
      const block = findCaptureBlock(
        active === null ? undefined : { processName: active.appName, title: active.title },
        exclusions,
      );
      if (block !== null) {
        log(`rolling memory skipped a frame: ${block.entry} has focus`);
        return;
      }

      const capture = await platform.captureDisplays(FRAME_LONG_SIDE, exclusions);
      const { windows } = await platform.listWindows(exclusions);
      // A pause pressed while the capture was in flight wins over the frame it produced.
      if (!this.recording || this.#options.isPaused()) return;

      const frames: StoredFrame[] = [];
      for (const display of capture.displays) {
        // A blocked display's placeholder and a display with no source are not memories.
        if (display.blocked !== null || display.image === null) continue;
        frames.push({
          displayId: display.id,
          png: Buffer.from(display.image.base64, 'base64'),
          width: display.image.width,
          height: display.image.height,
          displayWidth: Math.round(display.bounds.width * display.scaleFactor),
          displayHeight: Math.round(display.bounds.height * display.scaleFactor),
        });
      }
      this.ring.push({
        at: this.#options.clock.now(),
        frames,
        windows,
        focused: active === null ? undefined : { processName: active.appName, title: active.title },
      });
    } catch (error) {
      if (!isSightPaused(error)) log(`rolling memory could not capture: ${String(error)}`);
    } finally {
      this.#ticking = false;
    }
  }

  #sync(): void {
    const { clock } = this.#options;
    if (this.recording && this.#timer === null) {
      this.#timer = clock.setInterval(() => void this.tick(), ROLLING_TICK_MS);
    } else if (!this.recording && this.#timer !== null) {
      clock.clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.recording !== this.#lastReported) {
      this.#lastReported = this.recording;
      this.#options.onRecordingChange?.(this.recording);
    }
  }
}
