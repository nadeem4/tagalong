/**
 * IPC for making this PC the brain: register, remove and read the logon service by running
 * `tagalong service install|remove|status`. Installing also restarts the brain (ending one Tagalong
 * started first), which is what turns its network listener on. The service itself is the brain's (service.py);
 * this only asks for it and passes the command's answer on.
 */
import { lastLine } from '../last-line';
import { IPC } from '../../shared/ipc';
import type { BrainServiceOutcome, BrainServiceState } from '../../shared/ipc';
import type { IpcHandle } from './handle';

export interface BrainServiceDeps {
  run: (args: string[]) => Promise<{ code: number; out: string }>;
  /** True when the running brain was started by the logon service. */
  isService: () => Promise<boolean>;
  /** Ends the brain Tagalong started, so the service can bind its port; true when it did. */
  stop: () => Promise<boolean>;
  /** Starts the brain again under the new service; true when it did. */
  restart: () => Promise<boolean>;
  /** Resolves true once the link has dropped and come back, false if it never does. */
  restarted: () => Promise<boolean>;
}

const RESTART_FAILED = 'Scout could not restart the brain to turn network access on.';

/**
 * Waits for the link to leave `online` and return, so the old brain's still-open link is never
 * mistaken for the new one. `tries` is the length of each of the two waits.
 */
export async function waitForRestart(
  link: () => string,
  sleep: (ms: number) => Promise<void>,
  tries = 120,
): Promise<boolean> {
  const until = async (want: (state: string) => boolean): Promise<boolean> => {
    for (let n = 0; n < tries; n += 1) {
      if (want(link())) return true;
      await sleep(250);
    }
    return false;
  };
  return (
    (await until((state) => state !== 'online')) && (await until((state) => state === 'online'))
  );
}

async function install(deps: BrainServiceDeps): Promise<BrainServiceOutcome> {
  // A running brain only listens for other devices after it restarts. One Tagalong started holds
  // the port, so it ends first; the service then starts the brain itself on install.
  const wasService = await deps.isService();
  const back = deps.restarted();
  if (!wasService && !(await deps.stop())) return { ok: false, detail: RESTART_FAILED };
  const { code, out } = await deps.run(['service', 'install']);
  if (code !== 0) return { ok: false, detail: lastLine(out) };
  if (wasService && !(await deps.restart())) return { ok: false, detail: RESTART_FAILED };
  return (await back) ? { ok: true } : { ok: false, detail: RESTART_FAILED };
}

async function remove(deps: BrainServiceDeps): Promise<BrainServiceOutcome> {
  const { code, out } = await deps.run(['service', 'remove']);
  return code === 0 ? { ok: true } : { ok: false, detail: lastLine(out) };
}

export function registerBrainServiceIpc(handle: IpcHandle, deps: BrainServiceDeps): void {
  handle(IPC.brainServiceInstall, () => install(deps));
  handle(IPC.brainServiceRemove, () => remove(deps));
  handle(IPC.brainServiceStatus, async (): Promise<BrainServiceState> => {
    const { code, out } = await deps.run(['service', 'status']);
    if (code !== 0) return 'unknown';
    return out.trim() === 'installed' ? 'installed' : 'not_installed';
  });
}
