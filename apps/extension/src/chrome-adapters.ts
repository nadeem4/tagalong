import type { StorageArea } from './pairing';

/** `chrome.storage.local` as the pairing module's StorageArea. */
export const localStorageArea: StorageArea = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
  remove: (key) => chrome.storage.local.remove(key),
};
