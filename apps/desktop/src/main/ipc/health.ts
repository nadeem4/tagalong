import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface HealthIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
}

/**
 * The health check's one engine call: whether the browser extension is connected. The rest
 * of the card is read from calls the windows already make.
 */
export function registerHealthIpc(handle: IpcHandle, { engine }: HealthIpcDeps): void {
  handle(IPC.hostsStatus, async () => engine().call('hosts.status', {}));
}
