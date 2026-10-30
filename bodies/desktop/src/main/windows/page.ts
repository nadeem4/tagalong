/**
 * Loading a renderer page into a window, from the dev server or off disk. Contains RendererPage,
 * PRELOAD_PATH and loadPage.
 */

import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';

/** One HTML entry per window, all built by the renderer half of electron-vite. */
export type RendererPage = 'avatar' | 'panel' | 'welcome' | 'home';

/**
 * The compiled preload. It is a .cjs because a sandboxed preload can only be CommonJS,
 * while this package is ESM.
 */
export const PRELOAD_PATH = fileURLToPath(new URL('./preload/index.cjs', import.meta.url));

/** Dev serves the pages from vite; a packaged app loads them off disk. */
export function loadPage(window: BrowserWindow, page: RendererPage): void {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer !== undefined && devServer !== '') {
    void window.loadURL(`${devServer}/${page}.html`);
    return;
  }
  void window.loadFile(fileURLToPath(new URL(`./renderer/${page}.html`, import.meta.url)));
}
