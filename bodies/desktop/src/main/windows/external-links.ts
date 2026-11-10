/**
 * Every Tagalong window refuses to open child windows: an http(s) link goes to the person's own
 * browser, anything else (a registry's untrusted address included) goes nowhere.
 * Contains handleWindowOpen and denyNewWindows.
 */
import { shell, type BrowserWindow } from 'electron';

/** The decision, apart from Electron so it can be tested. */
export function handleWindowOpen(
  url: string,
  openExternal: (url: string) => unknown,
): { action: 'deny' } {
  if (/^https?:\/\//i.test(url)) void openExternal(url);
  return { action: 'deny' };
}

export function denyNewWindows(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) =>
    handleWindowOpen(url, (target) => shell.openExternal(target)),
  );
}
