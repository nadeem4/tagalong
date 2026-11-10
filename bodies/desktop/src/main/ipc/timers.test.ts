/** Tests for the timers IPC: the Timers tab lists and cancels through the brain's Home tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerTimersIpc } from './timers';

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
  registerTimersIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerTimersIpc', () => {
  it('reads the state and parses it', async () => {
    const wire = {
      timers: [
        {
          id: 't1',
          note: 'x',
          next_at: '2026-11-10T12:00:00+00:00',
          repeat_minutes: null,
          pending: false,
        },
      ],
    };
    const { invoke, calls } = setup(() => text(wire));
    expect(await invoke(IPC.timersState)).toEqual([
      {
        id: 't1',
        note: 'x',
        nextAt: '2026-11-10T12:00:00+00:00',
        repeatMinutes: null,
        pending: false,
      },
    ]);
    expect(calls).toEqual([['timers_state', {}]]);
  });

  it('checks the id before the brain hears of a cancel', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.timersCancel, 't1');
    expect(calls).toEqual([['timer_cancel', { id: 't1' }]]);
    await expect(invoke(IPC.timersCancel, '')).rejects.toThrow();
    await expect(invoke(IPC.timersCancel, 7)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
