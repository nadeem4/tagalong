/**
 * IPC for making this PC the brain: register, remove and read the logon service by running
 * `tagalong service install|remove|status`. The service itself is the brain's (service.py);
 * this only asks for it and passes the command's answer on.
 */
import { IPC } from '../../shared/ipc';
import type { BrainServiceOutcome, BrainServiceState } from '../../shared/ipc';
import type { IpcHandle } from './handle';

export interface BrainServiceDeps {
  run: (args: string[]) => Promise<{ code: number; out: string }>;
}

async function change(
  deps: BrainServiceDeps,
  action: 'install' | 'remove',
): Promise<BrainServiceOutcome> {
  const { code, out } = await deps.run(['service', action]);
  if (code === 0) return { ok: true };
  return { ok: false, detail: out.trim().split('\n').at(-1) ?? '' };
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
