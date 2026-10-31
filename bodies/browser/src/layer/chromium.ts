/**
 * The real Chrome behind the layer's interfaces: storage, tabs, page reading, permissions and
 * the brain websocket. The logic modules only ever see the interfaces in api.ts.
 */
import type { PartKind } from '../content/page-parts';
import type { PageReading } from '../content/read-page';
import { requestQuery } from '../permission/model';
import {
  originPattern,
  type Answer,
  type Need,
  type PermissionPrompt,
  type PermissionsApi,
} from '../permissions';
import type { BrainSocket } from '@tagalong/contract';
import type { OffscreenApi } from '../voice/mic-control';
import type {
  ActionsApi,
  PageApi,
  PictureApi,
  SearchApi,
  SearchHit,
  StorageArea,
  TabInfo,
  TabsApi,
} from './api';

function area(store: chrome.storage.StorageArea): StorageArea {
  return {
    get: async (key) => (await store.get(key))[key],
    set: (key, value) => store.set({ [key]: value }),
  };
}

/** Settings and the body id; survives browser restarts. */
export const chromeStorage: StorageArea = area(chrome.storage.local);

/** last_seq; survives worker restarts but not browser restarts. */
export const chromeSession: StorageArea = area(chrome.storage.session);

/** A browser WebSocket as the BrainClient's socket, the way the desktop wraps its own. */
export function webSocket(url: string): BrainSocket {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (f) => ws.addEventListener('open', () => f()),
    onMessage: (f) =>
      ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') f(event.data);
      }),
    // An error is always followed by close, which is where reconnecting starts.
    onClose: (f) => ws.addEventListener('close', () => f()),
  };
}

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
  async parts(tabId, part) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-reader.js'] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (kind: PartKind) => globalThis.__tagalongReadParts?.(kind) ?? null,
      args: [part],
    });
    const text = result?.result as string | null | undefined;
    if (text === null || text === undefined) {
      throw new Error('the page reader did not run in this tab');
    }
    return text;
  },
};

export const chromePicture: PictureApi = {
  async capture(windowId) {
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
    return { mime: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1) };
  },
};

const iso = (ms: number | undefined): string | undefined =>
  ms === undefined ? undefined : new Date(ms).toISOString();

function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): SearchHit[] {
  return nodes.flatMap((n) =>
    n.url === undefined
      ? []
      : [{ title: n.title, url: n.url, when: iso(n.dateAdded) } satisfies SearchHit],
  );
}

export const chromeSearch: SearchApi = {
  async history(text, sinceMs, untilMs, limit) {
    const items = await chrome.history.search({
      text,
      startTime: sinceMs ?? 0,
      ...(untilMs === undefined ? {} : { endTime: untilMs }),
      maxResults: limit,
    });
    return items.map((i) => ({
      title: i.title ?? '',
      url: i.url ?? '',
      when: iso(i.lastVisitTime),
    }));
  },
  async bookmarks(text, limit) {
    // An empty query is rejected by chrome.bookmarks.search; the newest bookmarks stand in.
    const nodes =
      text === '' ? await chrome.bookmarks.getRecent(limit) : await chrome.bookmarks.search(text);
    return flattenBookmarks(nodes).slice(0, limit);
  },
  async readingList(text, limit) {
    if (chrome.readingList?.query === undefined) {
      throw new Error('not supported in this browser');
    }
    const items = await chrome.readingList.query({});
    const needle = text.toLowerCase();
    return items
      .filter((i) => needle === '' || `${i.title} ${i.url}`.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((i) => ({ title: i.title, url: i.url, when: iso(i.creationTime) }));
  },
  async downloads(text, sinceMs, untilMs, limit) {
    const items = await chrome.downloads.search({
      query: text === '' ? [] : [text],
      ...(sinceMs === undefined ? {} : { startedAfter: new Date(sinceMs).toISOString() }),
      ...(untilMs === undefined ? {} : { startedBefore: new Date(untilMs).toISOString() }),
      orderBy: ['-startTime'],
      limit,
    });
    return items.map((d) => ({
      title: d.filename.split(/[\\/]/).pop() ?? d.filename,
      url: d.state,
      when: d.startTime,
    }));
  },
  async closedTabs(limit) {
    // Chrome refuses more than 25 here; a closed window counts as its tabs.
    const sessions = await chrome.sessions.getRecentlyClosed({
      maxResults: Math.min(limit, 25),
    });
    return sessions
      .flatMap((s) =>
        (s.tab ? [s.tab] : (s.window?.tabs ?? [])).map((tab) => ({
          title: tab.title ?? '',
          url: tab.url ?? '',
          when: iso(s.lastModified * 1000),
        })),
      )
      .slice(0, limit);
  },
};

export const chromeActions: ActionsApi = {
  async open(url) {
    const tab = await chrome.tabs.create({ url });
    return { id: tab.id ?? -1 };
  },
  async search(text) {
    // A blank tab first, so the new tab's id is known; the search then loads into it.
    const tab = await chrome.tabs.create({});
    try {
      await chrome.search.query({ text, tabId: tab.id as number });
    } catch (e) {
      // Do not leave an empty tab behind.
      if (tab.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => undefined);
      throw e;
    }
    return { id: tab.id ?? -1 };
  },
  async close(tabId) {
    await chrome.tabs.remove(tabId);
  },
  async switchTo(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  },
  async group(tabIds, title) {
    const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
    if (title !== undefined) await chrome.tabGroups.update(groupId, { title });
  },
  async reopen() {
    const [last] = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
    if (last === undefined) return null;
    const closed = last.tab ?? last.window?.tabs?.[0];
    const id = last.tab?.sessionId ?? last.window?.sessionId;
    await chrome.sessions.restore(id);
    return { title: closed?.title ?? '', url: closed?.url ?? '' };
  },
  async bookmark(title, url) {
    await chrome.bookmarks.create({ title, url });
  },
  async addToReadingList(title, url) {
    if (chrome.readingList?.addEntry === undefined) {
      throw new Error('not supported in this browser');
    }
    await chrome.readingList.addEntry({ title, url, hasBeenRead: false });
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

/** The offscreen page that holds the microphone while the person talks. */
export const chromeOffscreen: OffscreenApi = {
  exists: async () =>
    (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0,
  create: () =>
    chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Listen to the microphone only while the person is asking Scout by voice.',
    }),
  close: () => chrome.offscreen.closeDocument(),
};
