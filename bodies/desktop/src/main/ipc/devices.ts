/**
 * IPC behind the Devices page: the paired devices (list, rename, revoke) through the brain's
 * Home tools, and what Tailscale says on this PC. Contains
 * registerDevicesIpc.
 */
import { parseDevices } from '@tagalong/ui/shapes';
import type { TailscaleState } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

export interface DevicesDeps {
  brain: BrainCall;
  /** Runs `tailscale ip -4`; rejects when there is no tailscale command. */
  runTailscale: () => Promise<{ code: number; out: string }>;
}

export function registerDevicesIpc(handle: IpcHandle, deps: DevicesDeps): void {
  const { brain } = deps;
  handle(IPC.devicesList, async () => parseDevices(await callJson(brain, 'devices_list')));
  handle(IPC.devicesRename, async (_event, id: string, name: string) => {
    await callJson(brain, 'device_rename', { id, name });
  });
  handle(IPC.devicesRevoke, async (_event, id: string) => {
    await callJson(brain, 'device_revoke', { id });
  });
  handle(IPC.tailscaleState, async (): Promise<TailscaleState> => {
    try {
      const { code, out } = await deps.runTailscale();
      const ip = out.trim().split('\n')[0] ?? '';
      return { installed: true, ip: code === 0 && ip !== '' ? ip : null };
    } catch {
      return { installed: false, ip: null };
    }
  });
}
