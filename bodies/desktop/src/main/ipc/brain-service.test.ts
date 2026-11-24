/** Tests for the brain service IPC: install, remove and status, on a fake tagalong runner. */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerBrainServiceIpc } from './brain-service';
import { fakeIpc } from './fake-ipc';

function setup(
  reply: { code: number; out: string },
  over: { restarts?: boolean; online?: boolean } = {},
) {
  const ipc = fakeIpc();
  const ran: string[][] = [];
  registerBrainServiceIpc(ipc.handle, {
    run: async (args) => {
      ran.push(args);
      return reply;
    },
    restart: async () => {
      ran.push(['restart']);
      return over.restarts ?? true;
    },
    online: async () => {
      ran.push(['online']);
      return over.online ?? true;
    },
  });
  return { ipc, ran };
}

describe('registerBrainServiceIpc', () => {
  it('install runs `tagalong service install` and reports success', async () => {
    const { ipc, ran } = setup({ code: 0, out: 'Installed.' });
    expect(await ipc.invoke(IPC.brainServiceInstall)).toEqual({ ok: true });
    expect(ran).toEqual([['service', 'install'], ['restart'], ['online']]);
  });

  it('install is not done until the restarted brain is back, because only then does it listen', async () => {
    const stuck = setup({ code: 0, out: '' }, { restarts: false });
    expect(await stuck.ipc.invoke(IPC.brainServiceInstall)).toMatchObject({ ok: false });
    const silent = setup({ code: 0, out: '' }, { online: false });
    expect(await silent.ipc.invoke(IPC.brainServiceInstall)).toMatchObject({ ok: false });
  });

  it('a failed install gives the last line the command printed', async () => {
    const { ipc } = setup({ code: 1, out: 'starting\nfailed: Access is denied.\n' });
    expect(await ipc.invoke(IPC.brainServiceInstall)).toEqual({
      ok: false,
      detail: 'failed: Access is denied.',
    });
  });

  it('remove runs `tagalong service remove`', async () => {
    const { ipc, ran } = setup({ code: 0, out: 'Removed.' });
    expect(await ipc.invoke(IPC.brainServiceRemove)).toEqual({ ok: true });
    expect(ran).toEqual([['service', 'remove']]);
  });

  it('status is installed, not_installed, or unknown when the command could not tell', async () => {
    expect(await setup({ code: 0, out: 'installed\n' }).ipc.invoke(IPC.brainServiceStatus)).toBe(
      'installed',
    );
    expect(
      await setup({ code: 0, out: 'not installed\n' }).ipc.invoke(IPC.brainServiceStatus),
    ).toBe('not_installed');
    expect(await setup({ code: 1, out: 'boom' }).ipc.invoke(IPC.brainServiceStatus)).toBe(
      'unknown',
    );
  });
});
