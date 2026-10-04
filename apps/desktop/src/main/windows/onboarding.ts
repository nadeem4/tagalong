import { BrowserWindow } from 'electron';
import { PRELOAD_PATH, loadPage } from './page';

/**
 * The first-run setup wizard. A framed window like Settings, sized for one step at a time,
 * and centred: it is the first thing a new user sees, so it should not open in a corner.
 */
export function createOnboardingWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 620,
    height: 640,
    show: false,
    center: true,
    title: 'Welcome to Tagalong',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  loadPage(window, 'onboarding');
  return window;
}
