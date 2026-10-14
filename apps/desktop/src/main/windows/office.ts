import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * Home's narrowest: its nav and a page that still shows the overview two cards across.
 * Pages are fluid below their max widths, so a small laptop screen gets the whole window.
 */
export const HOME_MIN_WIDTH = 880;

/**
 * Home (the module keeps its old office name). A framed, centred window like Settings:
 * the nav on the left and one page beside it.
 */
export function createOfficeWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 800,
    // The size of the page, not the frame.
    useContentSize: true,
    minWidth: HOME_MIN_WIDTH,
    minHeight: 600,
    show: false,
    center: true,
    title: 'Home',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Escape closes it, like every other Tagalong window.
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') window.close();
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'office');
  return window;
}
