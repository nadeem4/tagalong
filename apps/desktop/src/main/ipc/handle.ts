/**
 * The small types every ipc module takes, so handlers are tested without Electron: IpcHandle,
 * IpcOn, IpcListener and EngineCall.
 */

import type { EngineClient } from '../engine-client';

/** One IPC handler, as ipcMain.handle takes it. The event is unused by these modules. */
export type IpcListener = (event: unknown, ...args: never[]) => unknown;

/** ipcMain.handle in the app, a recording fake in tests. */
export type IpcHandle = (channel: string, listener: IpcListener) => void;

/** ipcMain.on in the app, for messages the renderer sends without waiting for an answer. */
export type IpcOn = (channel: string, listener: (event: unknown, ...args: never[]) => void) => void;

/** The engine connection the handlers talk through. */
export type EngineCall = Pick<EngineClient, 'call'>;
