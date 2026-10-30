/**
 * Tests chromeSearch against a fake chrome global: the argument shapes Chrome is picky about
 * (the 25 cap on closed tabs, no endTime when open-ended) and the empty-text bookmarks path.
 */
// chromium.ts uses the chrome.* typings, which the shared test tsconfig does not load.
/// <reference types="chrome" />
// page-reader.ts declares the injected globals chromium.ts calls.
import type {} from '../content/page-reader';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SearchApi } from './api';

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
      { lastModified: 1, tab: { title: 'One', url: 'https://one.test' } },
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
  },
};

let chromeSearch: SearchApi;

beforeAll(async () => {
  vi.stubGlobal('chrome', fake);
  ({ chromeSearch } = await import('./chromium'));
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
