/**
 * Tests for adding and removing the folders Scout may use: the picker result is saved at
 * once, repeats are ignored, and removing a folder revokes the file tools on the very next
 * call (the tools read the live store, as index.ts wires them).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { SettingsStore } from '../settings-store';
import { fileTools } from '../tools/files';
import { fakeIpc } from './fake-ipc';
import { registerFileFoldersIpc } from './file-folders';

let dir: string;
let store: SettingsStore;
let picked: string | null;
const onSaved = vi.fn();

function setup() {
  const ipc = fakeIpc();
  registerFileFoldersIpc(ipc.handle, {
    pick: () => Promise.resolve(picked),
    settingsStore: () => store,
    onSaved,
  });
  return ipc;
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tagalong-folders-')));
  store = new SettingsStore(join(dir, 'data'));
  picked = null;
  onSaved.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

describe('registerFileFoldersIpc', () => {
  it('saves a picked folder and answers the new list', async () => {
    const { invoke } = setup();
    picked = join(dir, 'docs');
    expect(await invoke(IPC.fileFolderAdd)).toEqual([picked]);
    expect(store.get().fileFolders).toEqual([picked]);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('changes nothing when the picker is cancelled', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.fileFolderAdd)).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not add the same folder twice', async () => {
    const { invoke } = setup();
    picked = join(dir, 'docs');
    await invoke(IPC.fileFolderAdd);
    expect(await invoke(IPC.fileFolderAdd)).toEqual([picked]);
  });

  it('removes a folder and leaves the others', async () => {
    const { invoke } = setup();
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    store.set({ fileFolders: [a, b] });
    expect(await invoke(IPC.fileFolderRemove, a)).toEqual([b]);
    expect(store.get().fileFolders).toEqual([b]);
  });

  it('revokes file access on the very next call', async () => {
    const { invoke } = setup();
    const allowed = join(dir, 'allowed');
    const file = join(allowed, 'note.txt');
    mkdirSync(allowed);
    writeFileSync(file, 'hello');
    picked = allowed;
    await invoke(IPC.fileFolderAdd);

    const tools = fileTools({ folders: () => store.get().fileFolders, trash: async () => {} });
    const read = async (): Promise<string> =>
      (await tools['read_file']!({ path: file }))
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');
    expect(await read()).toContain('hello');

    await invoke(IPC.fileFolderRemove, allowed);
    expect(await read()).toMatch(/no folders chosen/i);
  });
});
