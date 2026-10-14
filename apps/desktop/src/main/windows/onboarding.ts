import { BrowserWindow, screen } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

const WIDTH = 900;
const HEIGHT = 620;

/**
 * Setup (option D). A framed window like Settings, centred on the screen the person is
 * using: it is the first thing a new user sees, so it must not open on a screen they are
 * not looking at. The page itself is 900 by 620, the size it was designed at.
 */
export function createOnboardingWindow(): BrowserWindow {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - HEIGHT) / 2)),
    show: false,
    title: 'Welcome to Tagalong',
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
  loadPage(window, 'onboarding');
  return window;
}
