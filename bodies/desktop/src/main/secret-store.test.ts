/** Tests for the safeStorage secret store. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRETS_FILENAME, SafeStorageSecretStore } from './secret-store';
import type { SafeStorageLike } from './secret-store';

// The real module needs a running Electron; the store takes the same shape as an
// argument, so the mock only has to exist for the import to resolve.
vi.mock('electron', () => ({ safeStorage: undefined }));

/**
 * Stands in for the OS keychain. Reversible but not readable, which is exactly the
 * property the on-disk test cares about.
 */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].map((b) => b ^ 0x5a)),
    decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-secrets-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SafeStorageSecretStore', () => {
  it('round-trips a secret through encrypt and decrypt', async () => {
    const store = new SafeStorageSecretStore(dataDir, fakeSafeStorage());

    await store.set('anthropic.apiKey', 'sk-ant-super-secret-value');

    expect(await store.get('anthropic.apiKey')).toBe('sk-ant-super-secret-value');
  });

  it('survives a restart, which is a fresh store over the same data dir', async () => {
    await new SafeStorageSecretStore(dataDir, fakeSafeStorage()).set(
      'anthropic.apiKey',
      'sk-ant-1',
    );

    const afterRestart = new SafeStorageSecretStore(dataDir, fakeSafeStorage());

    expect(await afterRestart.get('anthropic.apiKey')).toBe('sk-ant-1');
  });

  it('never writes the secret in plain text on disk', async () => {
    const store = new SafeStorageSecretStore(dataDir, fakeSafeStorage());
    await store.set('anthropic.apiKey', 'sk-ant-super-secret-value');

    const onDisk = readFileSync(join(dataDir, SECRETS_FILENAME));

    expect(onDisk.includes('sk-ant-super-secret-value')).toBe(false);
    expect(onDisk.toString('utf8')).not.toContain('super-secret');
  });

  it('returns null for a key that was never stored', async () => {
    expect(await new SafeStorageSecretStore(dataDir, fakeSafeStorage()).get('nope')).toBeNull();
  });

  it('deletes a secret', async () => {
    const store = new SafeStorageSecretStore(dataDir, fakeSafeStorage());
    await store.set('anthropic.apiKey', 'sk-ant-1');

    await store.delete('anthropic.apiKey');

    expect(await store.get('anthropic.apiKey')).toBeNull();
  });

  it('refuses to store anything when the OS has no encryption backend', async () => {
    const store = new SafeStorageSecretStore(dataDir, fakeSafeStorage(false));

    await expect(store.set('anthropic.apiKey', 'sk-ant-1')).rejects.toThrow(/encryption/i);
  });
});
