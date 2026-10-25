/** Tests for the Waiting on you IPC. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerAskIpc } from './asks';
import { fakeEngine, fakeIpc } from './fake-ipc';

describe('registerAskIpc', () => {
  it('lists, answers and opens asks through the engine', async () => {
    const ipc = fakeIpc();
    const engine = fakeEngine({
      'asks.list': { waiting: [], recent: [] },
      'asks.answer': { accepted: true },
      'asks.open': { opened: false },
    });
    registerAskIpc(ipc.handle, { engine: () => engine.client });
    expect(ipc.channels()).toEqual([IPC.answerAsk, IPC.listAsks, IPC.openAsk].sort());

    expect(await ipc.invoke(IPC.listAsks)).toEqual({ waiting: [], recent: [] });
    expect(await ipc.invoke(IPC.answerAsk, 'a1', 'approve')).toBe(true);
    expect(await ipc.invoke(IPC.openAsk, 'a2')).toBe(false);
    expect(engine.calls).toEqual([
      ['asks.list', {}],
      ['asks.answer', { id: 'a1', decision: 'approve' }],
      ['asks.open', { id: 'a2' }],
    ]);
  });
});
