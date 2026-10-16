/** Tests for SettingsStore and InMemorySecretStore: defaults, patches, corrupt files. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    writeFileSync(file, JSON.stringify({ userName: 'Ada', enginePort: 50000 }), 'utf8');
    const store = new SettingsStore(dataDir);
    expect(store.get().userName).toBe('Ada');
    expect(store.get().enginePort).toBe(50000);
    expect(store.get().historyMessages).toBe(SETTINGS_DEFAULTS.historyMessages);
  });

  it('loads a crew-era file, dropping the fields Tagalong no longer has', () => {
    writeFileSync(
      file,
      JSON.stringify({
        providerId: 'anthropic',
        defaultModel: 'claude-opus-5',
        defaultPetId: 'scout',
        hiddenPets: ['ink', 'bolt'],
        enginePort: 50000,
      }),
      'utf8',
    );
    const settings = new SettingsStore(dataDir).get();
    expect(settings.enginePort).toBe(50000);
    expect(settings.hiddenPets).toEqual(['ink', 'bolt']);
    expect(settings).not.toHaveProperty('providerId');
    expect(settings).not.toHaveProperty('defaultModel');
  });

  it('loads a file naming the retired nebius provider, and the next save drops it', () => {
    writeFileSync(
      file,
      JSON.stringify({
        userName: 'Ada',
        summarizer: { providerId: 'nebius', model: 'nvidia/x' },
        providerBaseUrls: { nebius: 'https://a.example/v1/', openrouter: 'https://b.example/v1/' },
      }),
      'utf8',
    );
    const store = new SettingsStore(dataDir);
    expect(store.get().userName).toBe('Ada');
    expect(store.get().summarizer).toBeNull();
    expect(existsSync(`${file}.bak`)).toBe(false);
    store.set({});
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk['summarizer']).toBeNull();
    expect(onDisk['providerBaseUrls']).toEqual({ openrouter: 'https://b.example/v1/' });
  });

  it('loads a file from the old setup wizard, and the next save drops its onboarding key', () => {
    writeFileSync(file, JSON.stringify({ userName: 'Ada', onboarding: { done: true } }), 'utf8');
    const store = new SettingsStore(dataDir);
    expect(store.get().userName).toBe('Ada');
    expect(store.get().welcome.done).toBe(false);
    store.set({ enginePort: 50000 });
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty('onboarding');
    expect(onDisk['userName']).toBe('Ada');
  });

  it('falls back to the last good copy when the file is malformed', () => {
    const store = new SettingsStore(dataDir);
    store.set({ userName: 'Ada' });
    store.set({ enginePort: 50000 });
    writeFileSync(file, '{ not json', 'utf8');
    expect(store.get().userName).toBe('Ada');
  });

  it('falls back to the defaults when the file fails the schema and no backup exists', () => {
    writeFileSync(file, JSON.stringify({ enginePort: 80 }), 'utf8');
    expect(new SettingsStore(dataDir).get()).toEqual(SETTINGS_DEFAULTS);
  });

  it('never silently overwrites an invalid file on read', () => {
    writeFileSync(file, '{ not json', 'utf8');
    new SettingsStore(dataDir).get();
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('keeps an invalid file aside before the next save replaces it', () => {
    writeFileSync(file, '{ not json', 'utf8');
    new SettingsStore(dataDir).set({ userName: 'Ada' });
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{ not json');
    expect(new SettingsStore(dataDir).get().userName).toBe('Ada');
  });
});

describe('SettingsStore.set', () => {
  it('merges a patch over current values and persists it', () => {
    const store = new SettingsStore(dataDir);
    store.set({ userName: 'Ada' });
    store.set({ enginePort: 50000 });

    expect(new SettingsStore(dataDir).get()).toEqual({
      ...SETTINGS_DEFAULTS,
      userName: 'Ada',
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
    expect(store.set({ userName: 'Ada' }).avatar).toEqual({ x: 12, y: 34 });
  });

  it('keeps the previous good file as a .bak and leaves no temp file', () => {
    const store = new SettingsStore(dataDir);
    store.set({ userName: 'Ada' });
    store.set({ enginePort: 50000 });
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).enginePort).toBe(
      SETTINGS_DEFAULTS.enginePort,
    );
    expect(existsSync(`${file}.tmp`)).toBe(false);
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
    store.set({ userName: 'Ada' });

    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('sk-ant-supersecret');
    expect(onDisk).not.toContain('apiKey');
  });
});
