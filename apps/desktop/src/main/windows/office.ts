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
    minWidth: 1100,
    minHeight: 560,
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
