import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * Home (the module keeps its old office name). A framed, centred window like Settings,
 * sized for its three columns: the agent list, the themed scene and the right panel
 * (activity, agent controls, meetings). The scene scrolls rather than shrinks when the
 * window is smaller than it.
 */
export function createOfficeWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 800,
    // The size of the page, not the frame: the scene is drawn for a full 800px.
    useContentSize: true,
    // Room for the agent list, the 600px scene and a readable right panel; the default
    // leaves the agent controls 560px. A smaller screen gets a smaller window.
    minWidth: 1200,
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

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'office');
  return window;
}
