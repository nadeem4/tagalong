import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * An ordinary framed window, unlike the two overlays: settings is a place the user goes
 * deliberately and expects to be able to move, close, and find in the taskbar.
 */
export function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 480,
    height: 460,
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
