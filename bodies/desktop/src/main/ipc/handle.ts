/**
 * The small types every ipc module takes, so handlers are tested without Electron: IpcHandle,
 * IpcOn, IpcListener and EngineCall.
 */

import type { HostToCoreMethod, ParamsOf, ResultOf } from '@tagalong/protocol';

/** One IPC handler, as ipcMain.handle takes it. The event is unused by these modules. */
export type IpcListener = (event: unknown, ...args: never[]) => unknown;

/** ipcMain.handle in the app, a recording fake in tests. */
export type IpcHandle = (channel: string, listener: IpcListener) => void;

/** ipcMain.on in the app, for messages the renderer sends without waiting for an answer. */
export type IpcOn = (channel: string, listener: (event: unknown, ...args: never[]) => void) => void;

/**
 * What the handlers call the old engine through. Nothing implements it any more (the brain
 * took over); `engine()` in main throws, so the handlers not yet moved fail with one sentence.
 */
export interface EngineCall {
  call<M extends HostToCoreMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
}
