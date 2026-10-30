/**
 * Tests chromeSearch and chromeActions against a fake chrome global: the argument shapes Chrome
 * is picky about (the 25 cap on closed tabs, no endTime when open-ended), the empty-text
 * bookmarks path, and how actions find the tab or session they act on.
 */
// chromium.ts uses the chrome.* typings, which the shared test tsconfig does not load.
/// <reference types="chrome" />
// page-reader.ts declares the injected globals chromium.ts calls.
import type {} from '../content/page-reader';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionsApi, SearchApi } from './api';

const fake = {
  storage: { local: {}, session: {} },
  history: { search: vi.fn(async (_q: unknown) => []) },
  bookmarks: {
    getRecent: vi.fn(async (_n: number) => [
      { id: '1', title: 'Recent', url: 'https://r.test', dateAdded: 0 },
      { id: '2', title: 'Folder' },
    ]),
    search: vi.fn(async (_q: string) => []),
  },
  sessions: {
    getRecentlyClosed: vi.fn(async (_q: unknown) => [
      { lastModified: 1, tab: { title: 'One', url: 'https://one.test', sessionId: 's1' } },
      {
        lastModified: 2,
        window: {
          tabs: [
            { title: 'Two', url: 'https://two.test' },
            { title: 'Three', url: 'https://three.test' },
          ],
        },
      },
    ]),
    restore: vi.fn(async (_id?: string) => undefined),
  },
  tabs: { create: vi.fn(async (_p: unknown) => ({ id: 42 })), group: vi.fn(async () => 9) },
  search: { query: vi.fn(async (_q: unknown) => undefined) },
  tabGroups: { update: vi.fn(async (_id: number, _p: unknown) => undefined) },
};

let chromeSearch: SearchApi;
let chromeActions: ActionsApi;

beforeAll(async () => {
  vi.stubGlobal('chrome', fake);
  ({ chromeSearch, chromeActions } = await import('./chromium'));
});

describe('chromeActions', () => {
  it('search loads the text into a fresh tab and returns that tab id', async () => {
    const out = await chromeActions.search('cats');
    expect(fake.search.query).toHaveBeenCalledWith({ text: 'cats', tabId: 42 });
    expect(out).toEqual({ id: 42 });
  });

  it('group names the group only when given a title', async () => {
    await chromeActions.group([1, 2]);
    expect(fake.tabGroups.update).not.toHaveBeenCalled();
    await chromeActions.group([1, 2], 'Trip');
    expect(fake.tabGroups.update).toHaveBeenCalledWith(9, { title: 'Trip' });
  });

  it('reopen restores the newest closed tab and says which, or null when none', async () => {
    const back = await chromeActions.reopen();
    expect(fake.sessions.restore).toHaveBeenCalledWith('s1');
    expect(back).toEqual({ title: 'One', url: 'https://one.test' });
    fake.sessions.getRecentlyClosed.mockResolvedValueOnce([]);
    expect(await chromeActions.reopen()).toBeNull();
  });

  it('the reading list is refused where the browser has none', async () => {
    await expect(chromeActions.addToReadingList('T', 'https://a.test')).rejects.toThrow(
      'not supported in this browser',
    );
  });
});

describe('chromeSearch', () => {
  it('closedTabs asks for at most 25 and includes the tabs of closed windows', async () => {
    const hits = await chromeSearch.closedTabs(50);
    expect(fake.sessions.getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 25 });
    expect(hits.map((h) => h.url)).toEqual([
      'https://one.test',
      'https://two.test',
      'https://three.test',
    ]);
  });

  it('closedTabs trims the result to the limit', async () => {
    expect(await chromeSearch.closedTabs(2)).toHaveLength(2);
  });

  it('history leaves endTime out when there is no until', async () => {
    await chromeSearch.history('cats', undefined, undefined, 5);
    const query = fake.history.search.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(query).toEqual({ text: 'cats', startTime: 0, maxResults: 5 });
    expect('endTime' in query).toBe(false);
  });

  it('bookmarks with empty text lists the recent ones, skipping folders', async () => {
    const hits = await chromeSearch.bookmarks('', 10);
    expect(fake.bookmarks.getRecent).toHaveBeenCalledWith(10);
    expect(fake.bookmarks.search).not.toHaveBeenCalled();
    expect(hits.map((h) => h.title)).toEqual(['Recent']);
  });
});
