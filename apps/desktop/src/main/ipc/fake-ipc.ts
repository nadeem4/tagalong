import type { HostToCoreMethod } from '@tagalong/protocol';
import type { EngineCall, IpcHandle, IpcListener } from './handle';

/** Stands in for ipcMain in tests: records each handler and invokes it as a renderer would. */
export function fakeIpc() {
  const handlers = new Map<string, IpcListener>();
  const handle: IpcHandle = (channel, listener) => {
    if (handlers.has(channel)) throw new Error(`${channel} is handled twice`);
    handlers.set(channel, listener);
  };
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const listener = handlers.get(channel);
    if (listener === undefined) throw new Error(`nothing handles ${channel}`);
    return listener({}, ...(args as never[]));
  };
  return { handle, invoke, channels: () => [...handlers.keys()].sort() };
}

/** An engine connection that answers each method from `answers` and records every call. */
export function fakeEngine(answers: Partial<Record<HostToCoreMethod, unknown>> = {}) {
  const calls: [method: string, params: unknown][] = [];
  const client = {
    call: (method: HostToCoreMethod, params: unknown) => {
      calls.push([method, params]);
      return Promise.resolve(answers[method]);
    },
  } as unknown as EngineCall;
  return { client, calls };
}
