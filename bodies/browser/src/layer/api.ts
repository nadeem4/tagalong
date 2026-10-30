/**
 * The thin edges the browser body talks through, so logic modules stay free of chrome.*.
 * Storage for identity and settings; tabs and page reading for the tabs tool.
 */
import type { PartKind } from '../content/page-parts';
import type { PageReading } from '../content/read-page';

export interface StorageArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  /** Chrome has put the tab to sleep; reading it would wake it. */
  discarded: boolean;
}

export interface TabsApi {
  list(): Promise<TabInfo[]>;
  get(id: number): Promise<TabInfo | null>;
  activeInFocusedWindow(): Promise<TabInfo | null>;
}

export interface PictureApi {
  /** A JPEG of what the given window is showing in its front tab. */
  capture(windowId: number): Promise<{ mime: 'image/jpeg'; base64: string }>;
}

/** One search result; for downloads `url` holds the state (complete, interrupted...). */
export interface SearchHit {
  title: string;
  url: string;
  when?: string | undefined;
}

export interface SearchApi {
  history(
    text: string,
    sinceMs: number | undefined,
    untilMs: number | undefined,
    limit: number,
  ): Promise<SearchHit[]>;
  bookmarks(text: string, limit: number): Promise<SearchHit[]>;
  /** Rejects with "not supported in this browser" when there is no reading list. */
  readingList(text: string, limit: number): Promise<SearchHit[]>;
  downloads(
    text: string,
    sinceMs: number | undefined,
    untilMs: number | undefined,
    limit: number,
  ): Promise<SearchHit[]>;
  closedTabs(limit: number): Promise<SearchHit[]>;
}

export interface ActionsApi {
  open(url: string): Promise<{ id: number }>;
  /** A web search in a new tab, run by the browser's own default search engine. */
  search(text: string): Promise<{ id: number }>;
  close(tabId: number): Promise<void>;
  switchTo(tabId: number): Promise<void>;
  group(tabIds: number[], title?: string): Promise<void>;
  /** The tab closed last, or null when there is none to bring back. */
  reopen(): Promise<{ title: string; url: string } | null>;
  bookmark(title: string, url: string): Promise<void>;
  /** Rejects with "not supported in this browser" when there is no reading list. */
  addToReadingList(title: string, url: string): Promise<void>;
}

export interface PageApi {
  /** Injects the page reader into the tab and returns what it read. */
  read(tabId: number): Promise<PageReading>;
  /** Injects the page reader and returns one kind of page structure as plain text. */
  parts(tabId: number, part: PartKind): Promise<string>;
}
