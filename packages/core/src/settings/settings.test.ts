import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import { InMemorySecretStore, SETTINGS_FILENAME, SettingsStore } from './settings';

let dataDir: string;
let file: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-settings-'));
  file = join(dataDir, SETTINGS_FILENAME);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SettingsStore.get', () => {
  it('yields every default when the file is missing', () => {
    const store = new SettingsStore(dataDir);
    expect(store.get()).toEqual(SETTINGS_DEFAULTS);
  });

  it('reads values written by a previous run', () => {
    writeFileSync(file, JSON.stringify({ providerId: 'fake', enginePort: 50000 }), 'utf8');
    const store = new SettingsStore(dataDir);
    expect(store.get().providerId).toBe('fake');
    expect(store.get().enginePort).toBe(50000);
    expect(store.get().defaultModel).toBe(SETTINGS_DEFAULTS.defaultModel);
  });

  it('throws an error naming the file when the JSON is malformed', () => {
    writeFileSync(file, '{ not json', 'utf8');
    const store = new SettingsStore(dataDir);
    expect(() => store.get()).toThrow(file);
    expect(() => store.get()).toThrow(/not valid JSON/i);
  });

  it('throws an error naming the offending field when the file fails the schema', () => {
    writeFileSync(file, JSON.stringify({ enginePort: 80 }), 'utf8');
    const store = new SettingsStore(dataDir);
    expect(() => store.get()).toThrow(file);
    expect(() => store.get()).toThrow(/enginePort/);
  });

  it('never silently resets an invalid file', () => {
    writeFileSync(file, '{ not json', 'utf8');
    const store = new SettingsStore(dataDir);
    expect(() => store.get()).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });
});

describe('SettingsStore.set', () => {
  it('merges a patch over current values and persists it', () => {
    const store = new SettingsStore(dataDir);
    store.set({ providerId: 'fake' });
    store.set({ enginePort: 50000 });

    expect(new SettingsStore(dataDir).get()).toEqual({
      ...SETTINGS_DEFAULTS,
      providerId: 'fake',
      enginePort: 50000,
    });
  });

  it('returns the merged settings', () => {
    const store = new SettingsStore(dataDir);
    expect(store.set({ hotkeys: { ask: 'Alt+Space' } }).hotkeys.ask).toBe('Alt+Space');
  });

  it('leaves omitted fields untouched', () => {
    const store = new SettingsStore(dataDir);
    store.set({ avatar: { x: 12, y: 34 } });
    expect(store.set({ providerId: 'fake' }).avatar).toEqual({ x: 12, y: 34 });
  });

  it('rejects an invalid patch without writing anything', () => {
    const store = new SettingsStore(dataDir);
    expect(() => store.set({ enginePort: 80 })).toThrow(/enginePort/);
    expect(store.get()).toEqual(SETTINGS_DEFAULTS);
  });
});

describe('InMemorySecretStore', () => {
  it('returns null for a key it has never seen', async () => {
    await expect(new InMemorySecretStore().get('anthropic.apiKey')).resolves.toBeNull();
  });

  it('round-trips a stored secret', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set('anthropic.apiKey', 'sk-ant-test');
    await expect(secrets.get('anthropic.apiKey')).resolves.toBe('sk-ant-test');
  });

  it('forgets a deleted secret', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set('anthropic.apiKey', 'sk-ant-test');
    await secrets.delete('anthropic.apiKey');
    await expect(secrets.get('anthropic.apiKey')).resolves.toBeNull();
  });

  it('keeps secrets out of the settings file on disk', async () => {
    const store = new SettingsStore(dataDir);
    const secrets = new InMemorySecretStore();

    await secrets.set('anthropic.apiKey', 'sk-ant-supersecret');
    store.set({ providerId: 'anthropic' });

    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('sk-ant-supersecret');
    expect(onDisk).not.toContain('apiKey');
  });
});
