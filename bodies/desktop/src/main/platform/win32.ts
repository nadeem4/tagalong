/**
 * The Windows adapter: the Platform built from Electron, PowerShell, get-windows and nut-js (the
 * one Ctrl+C keystroke). Contains Win32Platform.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { clipboard, desktopCapturer, nativeImage, screen } from 'electron';
import { buildInventory } from '@tagalong/core';
import type { CaptureExclusions } from '@tagalong/protocol';
import { captureActiveWindowImageWith, captureWindowImageWith } from './capture';
import { lookAtWindowWith } from './window-shot';
import { OCR_MAX_LONG_SIDE, recognizeText } from './ocr';
import type { LookAtWindowAnswer } from './window-shot';
import { captureDisplaysWith } from './displays';
import { captureRegionWith } from './region';
import type { RegionCaptureParams } from './region';
import type { DisplaysCapture } from './displays';
import { readWindowTextWith } from './read-text';
import type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
import { captureSelectionWith } from './selection';
import { createUiaTextLayer } from './text-layer';
import type { TextLayerProvider } from './text-layer';
import { runPowerShellScript } from './powershell';
import { LIST_WINDOWS_SCRIPT } from './window-helper';
import {
  attachTextCounts,
  countableHandles,
  parseWindowList,
  placeOnDisplays,
  screensOf,
} from './window-list';
import type { ActiveWindowInfo, CapturedImage, Platform, WindowInventory } from './index';

/**
 * Sends Ctrl+C to the foreground app.
 *
 * nut-js is imported here rather than at module scope on purpose: it loads a native
 * addon, and neither app startup nor the unit tests should pay for that just to read the
 * platform factory. This is the only keyboard automation in Tagalong.
 */
async function sendCopy(): Promise<void> {
  const { Key, keyboard } = await import('@nut-tree-fork/nut-js');
  keyboard.config.autoDelayMs = 0;
  await keyboard.pressKey(Key.LeftControl, Key.C);
  await keyboard.releaseKey(Key.LeftControl, Key.C);
}

/**
 * How long the window enumeration may take before partial output is used instead.
 *
 * A warm enumeration of twelve windows finishes well inside three seconds, but a cold
 * PowerShell start can take several more and look_at_window lists windows first. Eight
 * seconds stays under the 15 s cap on a whole body-tool run.
 */
const WINDOW_HELPER_TIMEOUT_MS = 8_000;

/** Windows adapter. Selection comes from the clipboard trick; page text needs the extension. */
export class Win32Platform implements Platform {
  async getActiveWindow(): Promise<ActiveWindowInfo | null> {
    // Lazy for the same reason as nut-js: get-windows carries a prebuilt native binding.
    const { activeWindow } = await import('get-windows');
    const window = await activeWindow();
    if (window === undefined) return null;
    return { appName: window.owner.name, title: window.title, bounds: window.bounds };
  }

  async captureSelection(): Promise<string | null> {
    return captureSelectionWith({
      clipboard,
      sendCopy,
      wait: (ms) => delay(ms),
      log: (message) => console.log(`[platform:win32] ${message}`),
    });
  }

  async readClipboard(): Promise<string> {
    return clipboard.readText();
  }

  async captureActiveWindowImage(
    maxLongSide: number,
    exclusions: CaptureExclusions,
  ): Promise<CapturedImage | null> {
    return captureActiveWindowImageWith(
      {
        desktopCapturer,
        screen,
        getActiveWindow: () => this.getActiveWindow(),
        listWindows: async () => (await this.listWindows(exclusions)).windows,
        exclusions,
        log: (message) => console.log(`[platform:win32] ${message}`),
      },
      maxLongSide,
    );
  }

  /**
   * Enumerates every top-level window through the UI Automation helper.
   *
   * PowerShell is spawned rather than linked: the alternative is a native addon for the
   * accessibility API, which would need building per Electron ABI and is a large
   * dependency for a read that happens on demand. The helper carries its own timeout and
   * returns partial output, so a window that will not answer costs some of the inventory
   * rather than the ask behind it.
   */
  get #textLayer(): TextLayerProvider {
    return createUiaTextLayer(runPowerShellScript);
  }

  async listWindows(
    exclusions: CaptureExclusions,
    options: { countText?: boolean } = {},
  ): Promise<WindowInventory> {
    const stdout = await runPowerShellScript(LIST_WINDOWS_SCRIPT, WINDOW_HELPER_TIMEOUT_MS);
    const outcome = parseWindowList(stdout);
    // Nothing to count and nothing to classify: hand the failure up rather than spending
    // a second PowerShell start on an empty list.
    if (outcome.failure !== undefined) return { windows: [], failure: outcome.failure };

    const placed = placeOnDisplays(outcome.windows, screen);
    // Counting is a second pass rather than part of enumeration, so an excluded window is
    // never walked: the exclusion list decides who is countable before anyone looks.
    // Keeping an eye needs titles only, so it skips the walk of every window's text.
    const counts =
      options.countText === false
        ? new Map<number, number>()
        : await this.#textLayer.countWindowText(countableHandles(placed, exclusions));
    return {
      windows: buildInventory(attachTextCounts(placed, counts), exclusions),
      displays: screensOf(screen),
    };
  }

  async lookAtWindow(
    params: { windowId: string; maxLongSide: number },
    exclusions: CaptureExclusions,
  ): Promise<LookAtWindowAnswer> {
    return lookAtWindowWith(
      {
        listWindows: async () => (await this.listWindows(exclusions)).windows,
        captureWindowImage: (handle, maxLongSide) =>
          captureWindowImageWith(
            { desktopCapturer, log: (message) => console.log(`[platform:win32] ${message}`) },
            handle,
            maxLongSide,
          ),
      },
      params,
    );
  }

  async readWindowText(
    params: ReadWindowTextParams,
    exclusions: CaptureExclusions,
  ): Promise<ReadTextAnswer> {
    return readWindowTextWith(
      {
        textLayer: this.#textLayer,
        listWindows: async () => (await this.listWindows(exclusions)).windows,
        readPicture: async (handle) => {
          const image = await captureWindowImageWith(
            { desktopCapturer },
            handle,
            OCR_MAX_LONG_SIDE,
          );
          return image === null ? '' : recognizeText(runPowerShellScript, image.base64);
        },
      },
      params,
    );
  }

  async captureRegion(
    params: RegionCaptureParams,
    exclusions: CaptureExclusions,
  ): Promise<CapturedImage | null> {
    return captureRegionWith(
      {
        screen: {
          getAllDisplays: () =>
            screen.getAllDisplays().map((display) => ({
              id: display.id,
              bounds: display.bounds,
              scaleFactor: display.scaleFactor,
              primary: display.id === screen.getPrimaryDisplay().id,
            })),
          getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
        },
        desktopCapturer,
        getActiveWindow: () => this.getActiveWindow(),
        listWindows: async () => (await this.listWindows(exclusions)).windows,
        exclusions,
        log: (message) => console.log(`[platform:win32] ${message}`),
      },
      params,
    );
  }

  async captureDisplays(
    maxLongSide: number,
    exclusions: CaptureExclusions,
  ): Promise<DisplaysCapture> {
    return captureDisplaysWith(
      {
        screen: {
          getAllDisplays: () =>
            screen.getAllDisplays().map((display) => ({
              id: display.id,
              bounds: display.bounds,
              scaleFactor: display.scaleFactor,
              primary: display.id === screen.getPrimaryDisplay().id,
            })),
          getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
        },
        desktopCapturer,
        getActiveWindow: () => this.getActiveWindow(),
        listWindows: async () => (await this.listWindows(exclusions)).windows,
        exclusions,
        // The one Electron call the composite makes. Everything upstream of it is buffer
        // arithmetic the unit tests drive with no display attached.
        encodePng: (bitmap) =>
          nativeImage
            .createFromBitmap(bitmap.data, { width: bitmap.width, height: bitmap.height })
            .toPNG(),
        log: (message) => console.log(`[platform:win32] ${message}`),
      },
      maxLongSide,
    );
  }
}
