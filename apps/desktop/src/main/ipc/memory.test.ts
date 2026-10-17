/** Tests for the What Scout remembers IPC. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerMemoryIpc } from './memory';

const ROW = {
  id: 'm1',
  kind: 'preference',
  text: 'Short answers.',
  createdAt: '2026-10-16T09:00:00.000Z',
};

function setup() {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'memory.list': { memories: [ROW] },
    'memory.delete': { deleted: true },
  });
  registerMemoryIpc(ipc.handle, { engine: () => engine.client });
  return { ...ipc, calls: engine.calls };
}

describe('registerMemoryIpc', () => {
  it('lists what Scout remembers, newest 200', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listMemories)).toEqual([ROW]);
    expect(calls).toEqual([['memory.list', { limit: 200 }]]);
  });

  it('deletes one memory', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.deleteMemory, 'm1')).toBe(true);
    expect(calls).toEqual([['memory.delete', { id: 'm1' }]]);
  });

  it('handles its two channels and nothing else', () => {
    expect(setup().channels()).toEqual([IPC.deleteMemory, IPC.listMemories].sort());
  });
});
