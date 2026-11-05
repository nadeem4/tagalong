/** Tests for the loops IPC: Home's switch, Held list, forget and wipe go through the brain's tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerLoopsIpc } from './loops';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup(answer: (tool: string, input?: object) => unknown = () => text({})) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  registerLoopsIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerLoopsIpc', () => {
  it('reads the state and checks its shape', async () => {
    const state = { apps: [{ id: 'gmail', name: 'Gmail', on: false }], loops: [] };
    const { invoke, calls } = setup(() => text(state));
    expect(await invoke(IPC.loopsState)).toEqual(state);
    expect(calls).toEqual([['loops_state', {}]]);
  });

  it('rejects a state the brain sent badly', async () => {
    const { invoke } = setup(() => text({ apps: 3 }));
    await expect(invoke(IPC.loopsState)).rejects.toThrow();
  });

  it('switches an app on or off', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.loopsSet, 'gmail', true);
    expect(calls).toEqual([['loops_set', { app: 'gmail', on: true }]]);
  });

  it('refuses a switch the page sent badly, before the brain hears of it', async () => {
    const { invoke, calls } = setup();
    await expect(invoke(IPC.loopsSet, '', true)).rejects.toThrow();
    await expect(invoke(IPC.loopsSet, 'gmail', 'yes')).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('forgets one loop and wipes all', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.loopForget, 'a1');
    await invoke(IPC.loopsWipe);
    expect(calls).toEqual([
      ['loop_forget', { id: 'a1' }],
      ['loops_wipe', {}],
    ]);
    await expect(invoke(IPC.loopForget, 7)).rejects.toThrow();
  });
});
