import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * The Crew Office. A framed, centred window like Settings, sized for its three columns:
 * the party list, the office floor and the meetings panel. The floor scrolls rather than
 * shrinks when the window is smaller than the office.
 */
export function createOfficeWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // The size of the page, not the frame: the office floor is drawn for a full 800px.
    useContentSize: true,
    // Room for the party list, the 600px floor and a readable meetings panel. A screen
    // smaller than the default still gets a smaller window; the floor then scrolls.
    minWidth: 1200,
    minHeight: 600,
    show: false,
    center: true,
    title: 'Crew Office',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'office');
  return window;
}
