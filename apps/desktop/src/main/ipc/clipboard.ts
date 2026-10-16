/**
 * The draft's Copy button: main writes text to the clipboard, only from the bubble. Contains
 * registerClipboardIpc and fromWindow, the sender check other handlers reuse.
 */

import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

/** The longest draft Copy puts on the clipboard: well past a 400-word draft. */
export const MAX_COPY_CHARS = 20_000;

export interface ClipboardIpcDeps {
  /** Electron's clipboard.writeText. Nothing here can read the clipboard. */
  writeText: (text: string) => void;
  /** Whether the call came from the bubble's window: the only one with a Copy button. */
  fromPanel: (event: unknown) => boolean;
}

/** The part of a BrowserWindow the sender check needs. */
interface SenderWindow {
  isDestroyed(): boolean;
  webContents: unknown;
}

/**
 * Whether an IPC call came from `window`'s own page. Electron sets `event.sender` in main,
 * so another window's page (or the extension, which has no IPC at all) cannot pass as it.
 */
export function fromWindow(window: () => SenderWindow | null): (event: unknown) => boolean {
  return (event) => {
    const current = window();
    if (current === null || current.isDestroyed()) return false;
    const sender = (event as { sender?: unknown } | null)?.sender;
    return sender !== undefined && sender === current.webContents;
  };
}

/**
 * Draft it for me: a draft's Copy. Main writes the clipboard because the renderer's
 * navigator.clipboard fails while the bubble is not focused. It only writes, only text,
 * only from the bubble, and never pastes: pasting stays the person's.
 */
export function registerClipboardIpc(handle: IpcHandle, deps: ClipboardIpcDeps): void {
  handle(IPC.copyText, (event, text: unknown) => {
    if (!deps.fromPanel(event)) throw new Error('Copy works only from the bubble.');
    if (typeof text !== 'string') throw new Error('Copy takes only text.');
    if (text.length > MAX_COPY_CHARS) throw new Error('That draft is too long to copy.');
    deps.writeText(text);
  });
}
