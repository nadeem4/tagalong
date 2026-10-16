/**
 * The standalone Settings window, opened only when the engine failed to start (Home needs the
 * engine). Contains createSettingsWindow.
 */

import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * An ordinary framed window, unlike the two overlays: settings is a place the user goes
 * deliberately and expects to be able to move, close, and find in the taskbar.
 */
export function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    // Room for the Settings nav and one section beside it.
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Tagalong Settings',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'settings');
  return window;
}
