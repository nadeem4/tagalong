/**
 * Where the browser add-on's folder is, and Show folder. Settings points people at this
 * folder for Chrome's Load unpacked; main finds it (packaged: beside app.asar, dev: the
 * browser body's build output) and reveals it in the file manager.
 * Contains BrowserIpcDeps, browserFolder and registerBrowserIpc.
 */
import { join, resolve } from 'node:path';
import { IPC } from '../../shared/ipc';
import type { BrowserFolder } from '../../shared/ipc';
import type { IpcHandle } from './handle';

export interface BrowserIpcDeps {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  exists: (path: string) => boolean;
  showItemInFolder: (path: string) => void;
}

export function browserFolder(deps: BrowserIpcDeps): BrowserFolder {
  const path = deps.packaged
    ? join(deps.resourcesPath, 'extension')
    : resolve(deps.appPath, '..', 'browser', 'dist');
  return { path, exists: deps.exists(path) };
}

export function registerBrowserIpc(handle: IpcHandle, deps: BrowserIpcDeps): void {
  handle(IPC.browserFolder, () => browserFolder(deps));
  handle(IPC.showBrowserFolder, () => {
    const folder = browserFolder(deps);
    if (!folder.exists) throw new Error('The browser add-on is not built yet');
    deps.showItemInFolder(folder.path);
  });
}
