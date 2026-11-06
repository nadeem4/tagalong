/**
 * IPC for how Scout reads the screen: reading:recheck (detect again and tell the brain) and
 * reading:open-language-settings (Windows' own language page). Contains registerReadingIpc.
 * The page address is fixed here, never taken from the renderer.
 */

import { IPC } from '../../shared/ipc';
import type { ReadingStatus } from '../platform/reading-status';
import type { IpcHandle } from './handle';

interface ReadingIpcDeps {
  detect: () => Promise<ReadingStatus>;
  push: (status: ReadingStatus) => void;
  /** Opens an address with the shell (shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
}

const LANGUAGE_SETTINGS = 'ms-settings:regionlanguage';

export function registerReadingIpc(
  handle: IpcHandle,
  { detect, push, openExternal }: ReadingIpcDeps,
): void {
  handle(IPC.readingRecheck, async (): Promise<void> => {
    push(await detect());
  });
  handle(IPC.readingOpenLanguageSettings, () => openExternal(LANGUAGE_SETTINGS));
}
