/**
 * Tests for the browser add-on's folder lookup and Show folder. Settings shows this folder so a
 * person can Load unpacked, so a wrong or missing path must be reported, not guessed.
 */
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { browserFolder, registerBrowserIpc } from './browser';
import type { BrowserIpcDeps } from './browser';
import { fakeIpc } from './fake-ipc';

const deps = (over: Partial<BrowserIpcDeps> = {}): BrowserIpcDeps => ({
  packaged: false,
  resourcesPath: '/res',
  appPath: '/repo/bodies/desktop',
  exists: () => true,
  showItemInFolder: vi.fn(),
  ...over,
});

describe('browserFolder', () => {
  it('folder_is_resources_extension_when_packaged', () => {
    const { path } = browserFolder(deps({ packaged: true }));
    expect(path.replaceAll('\\', '/')).toMatch(/\/res\/extension$/);
  });

  it('folder_is_the_browser_dist_in_dev', () => {
    const { path } = browserFolder(deps());
    expect(path.replaceAll('\\', '/')).toMatch(/\/repo\/bodies\/browser\/dist$/);
  });

  it('reports_exists_from_the_disk_check', () => {
    expect(browserFolder(deps({ exists: () => false })).exists).toBe(false);
    expect(browserFolder(deps({ exists: () => true })).exists).toBe(true);
  });
});

describe('registerBrowserIpc', () => {
  it('show_folder_reveals_the_folder', async () => {
    const d = deps();
    const ipc = fakeIpc();
    registerBrowserIpc(ipc.handle, d);
    const folder = await ipc.invoke(IPC.browserFolder);
    await ipc.invoke(IPC.showBrowserFolder);
    expect(d.showItemInFolder).toHaveBeenCalledWith((folder as { path: string }).path);
  });

  it('show_folder_refuses_when_not_built', async () => {
    const d = deps({ exists: () => false });
    const ipc = fakeIpc();
    registerBrowserIpc(ipc.handle, d);
    await expect(ipc.invoke(IPC.showBrowserFolder)).rejects.toThrow(
      'The browser add-on is not built yet',
    );
    expect(d.showItemInFolder).not.toHaveBeenCalled();
  });
});
