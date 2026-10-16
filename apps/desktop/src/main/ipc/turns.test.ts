/** Tests for the turn IPC: ask, interrupt, watches and remarks. */

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

  it('attaches the item dropped on Scout only when the ask is for it', async () => {
    const ipc = fakeIpc();
    const engine = fakeEngine({ ask: { turnId: 't1' } });
    const dropped = { kind: 'file' as const, name: 'a.md', path: '/w/a.md', text: 'abc' };
    let taken = 0;
    registerTurnIpc(ipc.handle, {
      engine: () => engine.client,
      maybeEngine: () => engine.client,
      pendingSnapshot: () => null,
      takeDrop: () => {
        taken += 1;
        return Promise.resolve(dropped);
      },
    });

    // An ordinary ask, typed or spoken, never carries the drop.
    await ipc.invoke(IPC.ask, { petId: 'scout', text: 'Scout, explain it', spoken: true });
    expect(taken).toBe(0);
    expect(engine.calls[0]?.[1]).not.toHaveProperty('snapshot');

    await ipc.invoke(IPC.ask, { petId: 'scout', text: 'Explain this.', drop: true });
    expect(taken).toBe(1);
    expect(engine.calls[1]?.[1]).toMatchObject({
      input: { text: 'Explain this.' },
      snapshot: { host: 'desktop', dropped },
    });
  });

  it('adds the drop to the snapshot the hotkey captured', async () => {
    const ipc = fakeIpc();
    const engine = fakeEngine({ ask: { turnId: 't1' } });
    const dropped = { kind: 'text' as const, text: 'hi' };
    registerTurnIpc(ipc.handle, {
      engine: () => engine.client,
      maybeEngine: () => engine.client,
      pendingSnapshot: () => SNAPSHOT,
      takeDrop: () => Promise.resolve(dropped),
    });
    await ipc.invoke(IPC.ask, { petId: 'scout', text: 'x', drop: true });
    expect(engine.calls[0]?.[1]).toMatchObject({ snapshot: { id: 's1', dropped } });
  });

  it('fails the ask with the read error, and asks nothing', async () => {
    const ipc = fakeIpc();
    const engine = fakeEngine({ ask: { turnId: 't1' } });
    registerTurnIpc(ipc.handle, {
      engine: () => engine.client,
      maybeEngine: () => engine.client,
      pendingSnapshot: () => null,
      takeDrop: () => Promise.reject(new Error('I couldn’t read gone.md.')),
    });
    await expect(ipc.invoke(IPC.ask, { petId: 'scout', text: 'x', drop: true })).rejects.toThrow(
      'gone.md',
    );
    expect(engine.calls).toEqual([]);
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
