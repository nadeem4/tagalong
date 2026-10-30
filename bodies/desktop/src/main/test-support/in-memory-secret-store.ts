/**
 * A volatile SecretStore for tests, so nothing under test needs Electron safeStorage.
 * Contains InMemorySecretStore.
 */
import type { SecretStore } from '../secret-store';

export class InMemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#secrets.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#secrets.delete(key);
  }
}
