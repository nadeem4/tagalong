/**
 * The small types every ipc module takes, so handlers are tested without Electron: IpcHandle,
 * IpcOn and IpcListener. Also fromWindow, the sender check handlers reuse.
 */

/** One IPC handler, as ipcMain.handle takes it. The event is unused by these modules. */
export type IpcListener = (event: unknown, ...args: never[]) => unknown;

/** ipcMain.handle in the app, a recording fake in tests. */
export type IpcHandle = (channel: string, listener: IpcListener) => void;

/** ipcMain.on in the app, for messages the renderer sends without waiting for an answer. */
export type IpcOn = (channel: string, listener: (event: unknown, ...args: never[]) => void) => void;

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
