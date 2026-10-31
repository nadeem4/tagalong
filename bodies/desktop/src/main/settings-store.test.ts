/** Tests for SettingsStore: defaults, patches, old files and corrupt files. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS } from '../shared/settings';
import { SETTINGS_FILENAME, SettingsStore } from './settings-store';

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
    writeFileSync(file, JSON.stringify({ listening: { always: true } }), 'utf8');
    const settings = new SettingsStore(dataDir).get();
    expect(settings.listening).toEqual({ always: true });
    expect(settings.avatar).toEqual(SETTINGS_DEFAULTS.avatar);
  });

  it('loads an old file, dropping the fields Tagalong no longer has', () => {
    writeFileSync(
      file,
      JSON.stringify({
        providerId: 'anthropic',
        userName: 'Ada',
        enginePort: 50000,
        summarizer: { providerId: 'nebius', model: 'x' },
        onboarding: { done: true },
        avatar: { x: 12, y: 34 },
      }),
      'utf8',
    );
    const store = new SettingsStore(dataDir);
    const settings = store.get();
    expect(settings.avatar).toEqual({ x: 12, y: 34 });
    for (const gone of ['providerId', 'userName', 'enginePort', 'summarizer', 'onboarding']) {
      expect(settings).not.toHaveProperty(gone);
    }
    store.set({});
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty('userName');
    expect(onDisk).not.toHaveProperty('summarizer');
  });

  it('falls back to the last good copy when the file is malformed', () => {
    const store = new SettingsStore(dataDir);
    store.set({ avatar: { x: 1, y: 2 } });
    store.set({ listening: { always: true } });
    writeFileSync(file, '{ not json', 'utf8');
    expect(store.get().avatar).toEqual({ x: 1, y: 2 });
  });

  it('falls back to the defaults when the file fails the schema and no backup exists', () => {
    writeFileSync(file, JSON.stringify({ listening: { always: 'yes' } }), 'utf8');
    expect(new SettingsStore(dataDir).get()).toEqual(SETTINGS_DEFAULTS);
  });

  it('never silently overwrites an invalid file on read', () => {
    writeFileSync(file, '{ not json', 'utf8');
    new SettingsStore(dataDir).get();
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('keeps an invalid file aside before the next save replaces it', () => {
    writeFileSync(file, '{ not json', 'utf8');
    new SettingsStore(dataDir).set({ avatar: { x: 1, y: 2 } });
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{ not json');
    expect(new SettingsStore(dataDir).get().avatar).toEqual({ x: 1, y: 2 });
  });
});

describe('SettingsStore.set', () => {
  it('merges a patch over current values and persists it', () => {
    const store = new SettingsStore(dataDir);
    store.set({ avatar: { x: 1, y: 2 } });
    store.set({ listening: { always: true } });

    expect(new SettingsStore(dataDir).get()).toEqual({
      ...SETTINGS_DEFAULTS,
      avatar: { x: 1, y: 2 },
      listening: { always: true },
    });
  });

  it('returns the merged settings', () => {
    const store = new SettingsStore(dataDir);
    expect(store.set({ hotkeys: { ask: 'Alt+Space' } }).hotkeys.ask).toBe('Alt+Space');
  });

  it('leaves omitted fields untouched', () => {
    const store = new SettingsStore(dataDir);
    store.set({ avatar: { x: 12, y: 34 } });
    expect(store.set({ listening: { always: true } }).avatar).toEqual({ x: 12, y: 34 });
  });

  it('keeps the previous good file as a .bak and leaves no temp file', () => {
    const store = new SettingsStore(dataDir);
    store.set({ avatar: { x: 1, y: 2 } });
    store.set({ listening: { always: true } });
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).listening).toEqual(
      SETTINGS_DEFAULTS.listening,
    );
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('rejects an invalid patch without writing anything', () => {
    const store = new SettingsStore(dataDir);
    expect(() => store.set({ listening: { always: 'yes' as never } })).toThrow(/listening/);
    expect(store.get()).toEqual(SETTINGS_DEFAULTS);
  });
});
