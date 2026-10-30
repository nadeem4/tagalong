/**
 * The thin edges the browser body talks through, so logic modules stay free of chrome.*.
 * Storage for identity and settings; tabs and page reading for the tabs tool.
 */
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

export interface PageApi {
  /** Injects the page reader into the tab and returns what it read. */
  read(tabId: number): Promise<PageReading>;
}
