/**
 * The real Chrome behind the layer's interfaces. The first pieces: tabs and page reading,
 * moved here from chrome-adapters.ts, which stays until the old extension code is removed.
 */
import type { PageReading } from '../content/read-page';
import { requestQuery } from '../permission/model';
import {
  originPattern,
  type Answer,
  type Need,
  type PermissionPrompt,
  type PermissionsApi,
} from '../permissions';
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

function chromeScope(need: Need): chrome.permissions.Permissions {
  return need.kind === 'permission'
    ? { permissions: [need.name] }
    : { origins: [originPattern(need.origin)] };
}

export const chromePermissions: PermissionsApi = {
  contains: (need) => chrome.permissions.contains(chromeScope(need)),
  async getAll() {
    const all = await chrome.permissions.getAll();
    return { permissions: all.permissions ?? [], origins: all.origins ?? [] };
  },
  remove: (need) => chrome.permissions.remove(chromeScope(need)),
};

/**
 * Asks in a small popup window, because chrome.permissions.request only works from a click on
 * an extension page, never from the service worker. The page answers with a message; closing the
 * window first counts as "closed".
 */
export const chromePrompt: PermissionPrompt = {
  ask(need, reason) {
    const id = crypto.randomUUID();
    return new Promise<Answer>((resolve) => {
      let windowId: number | undefined;
      const finish = (answer: Answer): void => {
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.windows.onRemoved.removeListener(onRemoved);
        resolve(answer);
      };
      const onMessage = (msg: unknown): void => {
        const m = msg as { type?: string; id?: string; granted?: boolean } | null;
        if (m?.type === 'permission-answer' && m.id === id) {
          finish(m.granted === true ? 'granted' : 'declined');
        }
      };
      // Windows removed before create() reports our id are remembered and checked afterwards.
      const removedEarly = new Set<number>();
      const onRemoved = (removed: number): void => {
        if (windowId === undefined) removedEarly.add(removed);
        else if (removed === windowId) finish('closed');
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.windows.onRemoved.addListener(onRemoved);
      const url = chrome.runtime.getURL(
        `permission/permission.html?${requestQuery({ id, need, reason })}`,
      );
      void chrome.windows.create({ url, type: 'popup', width: 420, height: 280 }).then(
        (w) => {
          windowId = w?.id;
          if (windowId !== undefined && removedEarly.has(windowId)) finish('closed');
        },
        () => finish('closed'),
      );
    });
  },
};
