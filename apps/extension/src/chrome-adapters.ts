import type { PageReading } from './content/read-page';
import type { StorageArea } from './pairing';
import type { TabAccess } from './tab-capture';

/** `chrome.storage.local` as the pairing module's StorageArea. */
export const localStorageArea: StorageArea = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
  remove: (key) => chrome.storage.local.remove(key),
};

/** Named the way the desktop host's process list names the same browser. */
function browserFamily(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'msedge';
  if (userAgent.includes('OPR/')) return 'opera';
  return 'chrome';
}

/**
 * The active tab of the last focused window, read through `activeTab`.
 *
 * Injection succeeds only on a tab the user has invoked the extension on — the toolbar
 * button, the shortcut, or the side panel open beside it. Elsewhere Chrome refuses, the
 * engine gets an error, and it falls back to the desktop host.
 */
export const chromeTabAccess: TabAccess = {
  browser: browserFamily(navigator.userAgent),
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return null;
    return {
      id: tab.id,
      ...(tab.url !== undefined ? { url: tab.url } : {}),
      ...(tab.title !== undefined ? { title: tab.title } : {}),
    };
  },
  async inject(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-reader.js'] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__tagalongReadPage?.() ?? null,
    });
    const reading = result?.result as PageReading | null | undefined;
    if (reading === null || reading === undefined) {
      throw new Error('the page reader did not run in this tab');
    }
    return reading;
  },
};
