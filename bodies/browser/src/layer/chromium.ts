/**
 * The real Chrome behind the layer's interfaces. The first pieces: tabs and page reading,
 * moved here from chrome-adapters.ts, which stays until the old extension code is removed.
 */
import type { PageReading } from '../content/read-page';
import type { PageApi, TabInfo, TabsApi } from './api';

function toInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id === undefined) return null;
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? '',
    url: tab.url ?? '',
    active: tab.active,
    discarded: tab.discarded ?? false,
  };
}

function infos(tabs: chrome.tabs.Tab[]): TabInfo[] {
  return tabs.map(toInfo).filter((t): t is TabInfo => t !== null);
}

export const chromeTabs: TabsApi = {
  async list() {
    return infos(await chrome.tabs.query({}));
  },
  async get(id) {
    try {
      return toInfo(await chrome.tabs.get(id));
    } catch {
      return null;
    }
  },
  async activeInFocusedWindow() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab === undefined ? null : toInfo(tab);
  },
};

export const chromePage: PageApi = {
  async read(tabId) {
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
