/**
 * The thin edges the browser body talks through, so logic modules stay free of chrome.*.
 * For now just the storage slice used by identity and settings.
 */
export interface StorageArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
