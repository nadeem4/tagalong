/**
 * The first-run walkthrough's window: frameless, about 1040x680, navy behind the page. Contains
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
    frame: false,
    resizable: false,
    show: false,
    center: true,
    title: 'Welcome to Tagalong',
    backgroundColor: '#0f1b33',
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
