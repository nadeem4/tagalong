/** Tests for the brain link IPC: the address, the link status, the setup state and Retry. */

import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { SetupState } from '../brain/launch';
import { createBrainSetup, registerBrainLinkIpc } from './brain-link';
import { fakeIpc } from './fake-ipc';

describe('registerBrainLinkIpc', () => {
  it('answers with the ws address, the current status and the setup state', async () => {
    const ipc = fakeIpc();
    let link: 'online' | 'offline' = 'online';
    const setup = createBrainSetup(
      async (on) => on('installing'),
      () => undefined,
    );
    registerBrainLinkIpc(ipc.handle, {
      brain: {
        addr: '127.0.0.1:47321',
        get link() {
          return link;
        },
      },
      setup,
    });
    expect(await ipc.invoke(IPC.brainLink)).toEqual({
      addr: 'ws://127.0.0.1:47321',
      status: 'online',
      setup: 'idle',
    });
    link = 'offline';
    await setup.retry();
    expect(await ipc.invoke(IPC.brainLink)).toEqual({
      addr: 'ws://127.0.0.1:47321',
      status: 'offline',
      setup: 'installing',
    });
  });

  it('the Retry call only runs the launch after a failure, so a second brain never starts', async () => {
    const ipc = fakeIpc();
    let launches = 0;
    let outcome: SetupState = 'idle';
    const setup = createBrainSetup(
      async (on) => {
        launches++;
        on(outcome);
      },
      () => undefined,
    );
    registerBrainLinkIpc(ipc.handle, { brain: { addr: 'x:1', link: 'online' }, setup });
    await ipc.invoke(IPC.brainSetupRetry);
    expect(launches).toBe(0);
    outcome = 'failed';
    await setup.retry();
    outcome = 'idle';
    await ipc.invoke(IPC.brainSetupRetry);
    expect(launches).toBe(2);
    await ipc.invoke(IPC.brainSetupRetry);
    expect(launches).toBe(2);
  });
});

describe('Start brain', () => {
  it('runs the launch while the brain is offline, which probes before it spawns', async () => {
    const ipc = fakeIpc();
    let launches = 0;
    const setup = createBrainSetup(
      async () => void launches++,
      () => undefined,
    );
    registerBrainLinkIpc(ipc.handle, { brain: { addr: 'x:1', link: 'offline' }, setup });
    await ipc.invoke(IPC.brainSetupRetry);
    expect(launches).toBe(1);
  });
});

describe('createBrainSetup', () => {
  it('tells Home on every state the launcher reports', async () => {
    let changes = 0;
    const setup = createBrainSetup(
      async (on) => {
        on('installing');
        on('failed');
      },
      () => void changes++,
    );
    await setup.retry();
    expect(setup.state).toBe('failed');
    expect(changes).toBe(2);
  });

  it('ignores Retry while a launch is running', async () => {
    let launches = 0;
    let finish: () => void = () => undefined;
    const setup = createBrainSetup(
      () => {
        launches++;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      () => undefined,
    );
    const first = setup.retry();
    await setup.retry();
    expect(launches).toBe(1);
    finish();
    await first;
  });

  it('runs again after a failure', async () => {
    const seen: SetupState[] = [];
    let ok = false;
    const setup = createBrainSetup(
      async (on) => {
        on('installing');
        on(ok ? 'idle' : 'failed');
      },
      () => void seen.push(setup.state),
    );
    await setup.retry();
    ok = true;
    await setup.retry();
    expect(seen).toEqual(['installing', 'failed', 'installing', 'idle']);
  });

  it('shows failed, not stuck, if the launch throws, and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setup = createBrainSetup(
      () => Promise.reject(new Error('boom')),
      () => undefined,
    );
    await setup.retry();
    expect(setup.state).toBe('failed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not start the brain'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    warn.mockRestore();
  });
});
