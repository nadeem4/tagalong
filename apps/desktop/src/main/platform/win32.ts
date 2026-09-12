import { setTimeout as delay } from 'node:timers/promises';
import { clipboard, desktopCapturer, screen } from 'electron';
import { captureActiveWindowImageWith } from './capture';
import { captureSelectionWith } from './selection';
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
}
