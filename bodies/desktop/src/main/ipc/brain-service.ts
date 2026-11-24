/**
 * IPC for making this PC the brain: register, remove and read the logon service by running
 * `tagalong service install|remove|status`. Installing also restarts the brain, which is what
 * turns its network listener on. The service itself is the brain's (service.py);
 * this only asks for it and passes the command's answer on.
 */
import { IPC } from '../../shared/ipc';
import type { BrainServiceOutcome, BrainServiceState } from '../../shared/ipc';
import type { IpcHandle } from './handle';

export interface BrainServiceDeps {
  run: (args: string[]) => Promise<{ code: number; out: string }>;
  /** Starts the brain again under the new service; true when it did. */
  restart: () => Promise<boolean>;
  /** Resolves true once the desktop is talking to the brain again, false if it never is. */
  online: () => Promise<boolean>;
}

const RESTART_FAILED = 'Scout could not restart the brain to turn network access on.';

async function change(
  deps: BrainServiceDeps,
  action: 'install' | 'remove',
): Promise<BrainServiceOutcome> {
  const { code, out } = await deps.run(['service', action]);
  if (code !== 0) return { ok: false, detail: out.trim().split('\n').at(-1) ?? '' };
  // A running brain only listens for other devices after it restarts.
  if (action === 'install' && !((await deps.restart()) && (await deps.online()))) {
    return { ok: false, detail: RESTART_FAILED };
  }
  return { ok: true };
}

export function registerBrainServiceIpc(handle: IpcHandle, deps: BrainServiceDeps): void {
  handle(IPC.brainServiceInstall, () => change(deps, 'install'));
  handle(IPC.brainServiceRemove, () => change(deps, 'remove'));
  handle(IPC.brainServiceStatus, async (): Promise<BrainServiceState> => {
    const { code, out } = await deps.run(['service', 'status']);
    if (code !== 0) return 'unknown';
    return out.trim() === 'installed' ? 'installed' : 'not_installed';
  });
}
