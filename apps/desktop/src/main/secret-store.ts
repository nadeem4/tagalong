import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretStore } from '@tagalong/core';

/** Encrypted secrets sit next to the database and settings in the host's data dir. */
export const SECRETS_FILENAME = 'secrets.json';

/** The slice of Electron safeStorage this store uses, so tests can supply their own. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * The engine's SecretStore backed by the OS keychain through Electron safeStorage.
 *
 * Only ciphertext is written, base64 wrapped so the file stays plain JSON. If the OS has
 * no encryption backend the store refuses to write at all: an API key sitting readable in
 * the user's profile directory is a worse outcome than a settings screen that says no.
 */
export class SafeStorageSecretStore implements SecretStore {
  readonly #dataDir: string;
  readonly #file: string;
  readonly #storage: SafeStorageLike;

  constructor(dataDir: string, storage: SafeStorageLike = safeStorage) {
    this.#dataDir = dataDir;
    this.#file = join(dataDir, SECRETS_FILENAME);
    this.#storage = storage;
  }

  /** Absolute path of the file this store reads and writes. */
  get file(): string {
    return this.#file;
  }

  async get(key: string): Promise<string | null> {
    const encoded = this.#readAll()[key];
    if (encoded === undefined) return null;
    return this.#storage.decryptString(Buffer.from(encoded, 'base64'));
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.#storage.isEncryptionAvailable()) {
      throw new Error(
        'This machine has no OS encryption backend, so Tagalong will not store the key. ' +
          'Use an environment variable for now.',
      );
    }
    const secrets = this.#readAll();
    secrets[key] = this.#storage.encryptString(value).toString('base64');
    this.#writeAll(secrets);
  }

  async delete(key: string): Promise<void> {
    const secrets = this.#readAll();
    delete secrets[key];
    this.#writeAll(secrets);
  }

  #readAll(): Record<string, string> {
    let text: string;
    try {
      text = readFileSync(this.#file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
    return JSON.parse(text) as Record<string, string>;
  }

  #writeAll(secrets: Record<string, string>): void {
    mkdirSync(this.#dataDir, { recursive: true });
    // 0600 so the ciphertext is not world-readable even before the OS layer is considered.
    writeFileSync(this.#file, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
