/**
 * The first-run walkthrough's window: about 1040x680 with no title bar of its own, only the
 * system's close button over the page (Escape does not close it). Contains
 * createWalkthroughWindow. Closing it never marks the walkthrough seen; that is Finish and Skip.
 */

import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/** Opens the walkthrough, at `step` when one is named (the no-key button opens step 9). */
export function createWalkthroughWindow(step?: number): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040,
    height: 680,
    useContentSize: true,
    // Frameless would leave no way to close it, since Escape does nothing here; the overlay
    // keeps the system's own buttons over the page's 40px top strip.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F6F7FB', symbolColor: '#12162B', height: 40 },
    resizable: false,
    maximizable: false,
    show: false,
    center: true,
    title: 'Welcome to Tagalong',
    backgroundColor: '#F6F7FB',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'walkthrough', step === undefined ? {} : { step: String(step) });
  return window;
}
