/** Tests for the brain service IPC: install, remove and status, on a fake tagalong runner. */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerBrainServiceIpc, waitForRestart } from './brain-service';
import { fakeIpc } from './fake-ipc';

function setup(
  reply: { code: number; out: string },
  over: { service?: boolean; stops?: boolean; restarts?: boolean; back?: boolean } = {},
) {
  const ipc = fakeIpc();
  const ran: string[][] = [];
  registerBrainServiceIpc(ipc.handle, {
    run: async (args) => {
      ran.push(args);
      return reply;
    },
    isService: async () => over.service ?? false,
    stop: async () => {
      ran.push(['stop']);
      return over.stops ?? true;
    },
    restart: async () => {
      ran.push(['restart']);
      return over.restarts ?? true;
    },
    restarted: async () => {
      ran.push(['back']);
      return over.back ?? true;
    },
  });
  return { ipc, ran };
}

const link = (states: string[]) => {
  let i = 0;
  return () => states[Math.min(i++, states.length - 1)]!;
};
const noWait = async () => undefined;

describe('registerBrainServiceIpc', () => {
  it('install stops a brain that is not the service first, so the service can bind, then waits for it to come back', async () => {
    const { ipc, ran } = setup({ code: 0, out: 'Installed.' });
    expect(await ipc.invoke(IPC.brainServiceInstall)).toEqual({ ok: true });
    expect(ran).toEqual([['back'], ['stop'], ['service', 'install']]);
  });

  it('install on a brain that already is the service restarts it instead of stopping it', async () => {
    const { ipc, ran } = setup({ code: 0, out: '' }, { service: true });
    expect(await ipc.invoke(IPC.brainServiceInstall)).toEqual({ ok: true });
    expect(ran).toEqual([['back'], ['service', 'install'], ['restart']]);
  });

  it('install is not done until the brain is back, because only then does it listen', async () => {
    for (const over of [{ stops: false }, { back: false }]) {
      const failed = setup({ code: 0, out: '' }, over);
      expect(await failed.ipc.invoke(IPC.brainServiceInstall)).toMatchObject({ ok: false });
    }
    const noRestart = setup({ code: 0, out: '' }, { service: true, restarts: false });
    expect(await noRestart.ipc.invoke(IPC.brainServiceInstall)).toMatchObject({ ok: false });
  });

  it('waits for the link to go offline and come back, not for the old link that is still up', async () => {
    expect(
      await waitForRestart(link(['online', 'online', 'offline', 'offline', 'online']), noWait),
    ).toBe(true);
    expect(await waitForRestart(link(['online']), noWait, 3)).toBe(false);
    expect(await waitForRestart(link(['online', 'offline']), noWait, 3)).toBe(false);
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
