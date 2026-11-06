/**
 * IPC for how Scout reads the screen: reading:status (the brain's rows for Home, as text),
 * reading:recheck (detect again and tell the brain) and
 * reading:open-language-settings (Windows' own language page). Contains registerReadingIpc.
 * The page address is fixed here, never taken from the renderer.
 */

import { IPC } from '../../shared/ipc';
import type { ReadingStatus } from '../platform/reading-status';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

interface ReadingIpcDeps {
  brain: BrainCall;
  detect: () => Promise<ReadingStatus>;
  push: (status: ReadingStatus) => void;
  /** Opens an address with the shell (shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
}

const LANGUAGE_SETTINGS = 'ms-settings:regionlanguage';

export function registerReadingIpc(
  handle: IpcHandle,
  { brain, detect, push, openExternal }: ReadingIpcDeps,
): void {
  handle(IPC.readingStatus, async (): Promise<string> => {
    const part = (await brain.call('reading_status', {})).find((p) => p.type === 'text');
    return part?.type === 'text' ? part.text : '{"rows":[]}';
  });
  handle(IPC.readingRecheck, async (): Promise<void> => {
    push(await detect());
  });
  handle(IPC.readingOpenLanguageSettings, () => openExternal(LANGUAGE_SETTINGS));
}
