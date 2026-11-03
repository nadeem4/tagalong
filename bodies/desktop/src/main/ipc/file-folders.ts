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
  /** Opens the system folder picker; null when the person cancels. */
  pick: () => Promise<string | null>;
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

  handle(IPC.fileFolderAdd, async () => {
    const current = deps.settingsStore().get().fileFolders;
    const chosen = await deps.pick();
    if (chosen === null || current.includes(chosen)) return current;
    return save([...current, chosen]);
  });

  handle(IPC.fileFolderRemove, (_event, path: string) => {
    const current = deps.settingsStore().get().fileFolders;
    return save(current.filter((folder) => folder !== path));
  });
}
