import { describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerTurnIpc } from './turns';

const SNAPSHOT = { id: 's1' } as unknown as ContextSnapshot;

function setup(snapshot: ContextSnapshot | null = null, engineUp = true) {
  const ipc = fakeIpc();
  const engine = fakeEngine({ ask: { turnId: 't1' } });
  registerTurnIpc(ipc.handle, {
    engine: () => engine.client,
    maybeEngine: () => (engineUp ? engine.client : null),
    pendingSnapshot: () => snapshot,
  });
  return { ...ipc, calls: engine.calls };
}

describe('registerTurnIpc', () => {
  it('asks with the captured snapshot and only the fields that were given', async () => {
    const { invoke, calls } = setup(SNAPSHOT);
    expect(await invoke(IPC.ask, { petId: 'scout', text: 'hi', spoken: true })).toEqual({
      turnId: 't1',
    });
    expect(calls).toEqual([
      ['ask', { petId: 'scout', input: { text: 'hi' }, snapshot: SNAPSHOT, spoken: true }],
    ]);
  });

  it('asks with empty text and no snapshot when there is none', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.ask, { petId: 'scout', conversationId: 'c1' });
    expect(calls).toEqual([['ask', { petId: 'scout', conversationId: 'c1', input: { text: '' } }]]);
  });

  it('stops a watch and interrupts a turn', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.stopWatch, 'w1');
    await invoke(IPC.interrupt, 't1');
    expect(calls).toEqual([
      ['watch.stop', { watchId: 'w1' }],
      ['interrupt', { turnId: 't1' }],
    ]);
  });

  it("passes a remark's two buttons on, and does nothing with no engine", async () => {
    const up = setup();
    await up.invoke(IPC.remarkNotNow);
    await up.invoke(IPC.remarkAccept, 'r1');
    expect(up.calls).toEqual([
      ['keepAnEye.notNow', {}],
      ['keepAnEye.accept', { remarkId: 'r1' }],
    ]);

    const down = setup(null, false);
    await down.invoke(IPC.remarkNotNow);
    await down.invoke(IPC.remarkAccept, 'r1');
    expect(down.calls).toEqual([]);
  });
});
