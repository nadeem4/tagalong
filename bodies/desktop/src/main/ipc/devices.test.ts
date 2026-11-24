/**
 * Tests for the devices IPC: rename and revoke go through the brain's tools, and the Tailscale
 * state comes from `tailscale ip -4` on a fake runner.
 */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerDevicesIpc } from './devices';
import { fakeIpc } from './fake-ipc';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup(
  answer: (tool: string) => unknown,
  tailscale: { code: number; out: string } | 'missing' = 'missing',
) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  registerDevicesIpc(ipc.handle, {
    brain: {
      call: (tool: string, input?: object) => {
        calls.push([tool, input]);
        try {
          return Promise.resolve(answer(tool)) as Promise<never>;
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
    },
    runTailscale: () =>
      tailscale === 'missing' ? Promise.reject(new Error('ENOENT')) : Promise.resolve(tailscale),
  });
  return { ...ipc, calls };
}

describe('registerDevicesIpc', () => {
  it('sends rename and revoke to the brain', async () => {
    const { invoke, calls } = setup(() => text({ ok: true }));
    await invoke(IPC.devicesRename, 'a', 'Work laptop');
    await invoke(IPC.devicesRevoke, 'a');
    expect(calls).toEqual([
      ['device_rename', { id: 'a', name: 'Work laptop' }],
      ['device_revoke', { id: 'a' }],
    ]);
  });

  it('reads the tailnet address from tailscale, and says not installed when it is missing', async () => {
    const found = setup(() => text({}), { code: 0, out: '100.64.0.7\n' });
    expect(await found.invoke(IPC.tailscaleState)).toEqual({ installed: true, ip: '100.64.0.7' });
    const signedOut = setup(() => text({}), { code: 1, out: 'not logged in' });
    expect(await signedOut.invoke(IPC.tailscaleState)).toEqual({ installed: true, ip: null });
    const missing = setup(() => text({}), 'missing');
    expect(await missing.invoke(IPC.tailscaleState)).toEqual({ installed: false, ip: null });
  });
});
