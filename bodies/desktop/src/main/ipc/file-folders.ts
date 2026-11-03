/**
 * IPC for the folders Scout's file tools may use: add (opens the folder picker, saves the
 * choice) and remove. Both save at once and answer the list, because the file tools read
 * the live settings on every call: a removed folder is refused from the next call on.
 * Contains registerFileFoldersIpc.
 */

import type { Settings, SettingsPatch } from '../../shared/settings';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

interface FileFoldersIpcDeps {
  /** Opens the system folder picker over the asking window; null when the person cancels. */
  pick: (event: unknown) => Promise<string | null>;
  /** Folder paths compare without case (Windows). Defaults to the running system. */
  windows?: boolean;
  settingsStore: () => { get(): Settings; set(patch: SettingsPatch): Settings };
  /** Keeps the running copy of the settings and tells every open window. */
  onSaved: (settings: Settings) => void;
}

export function registerFileFoldersIpc(handle: IpcHandle, deps: FileFoldersIpcDeps): void {
  const save = (fileFolders: string[]): string[] => {
    const saved = deps.settingsStore().set({ fileFolders });
    deps.onSaved(saved);
    return saved.fileFolders;
  };

  const windows = deps.windows ?? process.platform === 'win32';
  const same = (a: string, b: string): boolean =>
    windows ? a.toLowerCase() === b.toLowerCase() : a === b;

  handle(IPC.fileFolderAdd, async (event) => {
    const chosen = await deps.pick(event);
    // Read after the picker closes: another Add may have saved while it was open.
    const current = deps.settingsStore().get().fileFolders;
    if (chosen === null || current.some((folder) => same(folder, chosen))) return current;
    return save([...current, chosen]);
  });

  handle(IPC.fileFolderRemove, (_event, path: string) => {
    const current = deps.settingsStore().get().fileFolders;
    return save(current.filter((folder) => folder !== path));
  });
}
