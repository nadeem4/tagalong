/**
 * Test double for the ipc handlers: fakeIpc stands in for ipcMain. Used only by tests.
 */

import type { IpcHandle, IpcListener, IpcOn } from './handle';

/**
 * Stands in for ipcMain in tests: records each handler and invokes it as a renderer would,
 * and each `on` listener, which `send` calls as a renderer's ipcRenderer.send would.
 */
export function fakeIpc() {
  const handlers = new Map<string, IpcListener>();
  const handle: IpcHandle = (channel, listener) => {
    if (handlers.has(channel)) throw new Error(`${channel} is handled twice`);
    handlers.set(channel, listener);
  };
  /** As a renderer would, from the window `event` stands for. */
  const invokeWith = async (event: unknown, channel: string, ...args: unknown[]) => {
    const listener = handlers.get(channel);
    if (listener === undefined) throw new Error(`nothing handles ${channel}`);
    return listener(event, ...(args as never[]));
  };
  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    invokeWith({}, channel, ...args);
  const ons = new Map<string, (event: unknown, ...args: never[]) => void>();
  const on: IpcOn = (channel, listener) => void ons.set(channel, listener);
  const send = (channel: string, ...args: unknown[]): void =>
    ons.get(channel)?.({}, ...(args as never[]));
  return { handle, invoke, invokeWith, on, send, channels: () => [...handlers.keys()].sort() };
}
