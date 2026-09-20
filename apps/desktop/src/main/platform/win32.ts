import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { clipboard, desktopCapturer, nativeImage, screen } from 'electron';
import { buildInventory } from '@tagalong/core';
import type { CaptureExclusions, WindowEntry } from '@tagalong/protocol';
import { captureActiveWindowImageWith } from './capture';
import { captureDisplaysWith } from './displays';
import type { DisplaysCapture } from './displays';
import { readWindowTextWith } from './read-text';
import type { ReadTextAnswer, ReadWindowTextParams } from './read-text';
import { captureSelectionWith } from './selection';
import { createUiaTextLayer } from './text-layer';
import type { TextLayerProvider } from './text-layer';
import { LIST_WINDOWS_SCRIPT, runWindowHelper } from './window-helper';
import {
  attachTextCounts,
  countableHandles,
  parseWindowList,
  placeOnDisplays,
} from './window-list';
import type { ActiveWindowInfo, CapturedImage, Platform } from './index';

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
 * The phase page asks for three seconds. Measured on a live twelve-window desktop the
 * whole enumeration finished well inside it, and this read sits in front of a capture the
 * user is waiting on.
 */
const WINDOW_HELPER_TIMEOUT_MS = 3_000;

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

  async captureActiveWindowImage(maxLongSide: number): Promise<CapturedImage | null> {
    return captureActiveWindowImageWith(
      {
        desktopCapturer,
        screen,
        getActiveWindow: () => this.getActiveWindow(),
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
  /**
   * Runs a PowerShell script and resolves with whatever it printed.
   *
   * Shared by enumeration and the text layer so there is one place that decides how
   * PowerShell is started, and one place to change when it needs to be started
   * differently.
   */
  #runScript(script: string, timeoutMs: number): Promise<string> {
    return runWindowHelper(
      (encoded) =>
        spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-EncodedCommand',
            encoded,
          ],
          { windowsHide: true },
        ),
      script,
      timeoutMs,
    );
  }

  get #textLayer(): TextLayerProvider {
    return createUiaTextLayer((script, timeoutMs) => this.#runScript(script, timeoutMs));
  }

  async listWindows(exclusions: CaptureExclusions): Promise<WindowEntry[]> {
    const stdout = await this.#runScript(LIST_WINDOWS_SCRIPT, WINDOW_HELPER_TIMEOUT_MS);
    const placed = placeOnDisplays(parseWindowList(stdout), screen);

    // Counting is a second pass rather than part of enumeration, so an excluded window is
    // never walked: the exclusion list decides who is countable before anyone looks.
    const counts = await this.#textLayer.countWindowText(countableHandles(placed, exclusions));
    return buildInventory(attachTextCounts(placed, counts), exclusions);
  }

  async readWindowText(
    params: ReadWindowTextParams,
    exclusions: CaptureExclusions,
  ): Promise<ReadTextAnswer> {
    return readWindowTextWith(
      { textLayer: this.#textLayer, listWindows: () => this.listWindows(exclusions) },
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
        listWindows: () => this.listWindows(exclusions),
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
