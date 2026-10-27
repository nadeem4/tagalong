/** Tests for the What Scout remembers IPC, which reads and deletes through the brain's tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { BrainOffline, RpcError } from '../brain/brain-client';
import { fakeIpc } from './fake-ipc';
import { registerMemoryIpc } from './memory';

const AT = '2026-10-16T09:00:00.000Z';
const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup(answer: (tool: string, input?: object) => Promise<unknown> | unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  registerMemoryIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerMemoryIpc', () => {
  it('lists what Scout remembers from the brain, mapped to what Home shows', async () => {
    const { invoke, calls } = setup(() =>
      text({
        memories: [
          { id: 3, kind: 'instruction', text: 'Short answers.', cadence: null, at: AT },
          { id: 2, kind: 'about_you', text: 'Works on Tagalong', cadence: null, at: AT },
          { id: 1, kind: 'summary', text: 'Talked about launch.', cadence: null, at: AT },
        ],
      }),
    );
    expect(await invoke(IPC.listMemories)).toEqual([
      { id: '3', kind: 'preference', text: 'Short answers.', createdAt: AT },
      { id: '2', kind: 'fact', text: 'Works on Tagalong', createdAt: AT },
      { id: '1', kind: 'summary', text: 'Talked about launch.', createdAt: AT },
    ]);
    expect(calls).toEqual([['list_memories', {}]]);
  });

  it('deletes one memory by the brain id, and says it worked', async () => {
    const { invoke, calls } = setup(() => [{ type: 'text', text: 'forgot fact #2: x' }]);
    expect(await invoke(IPC.deleteMemory, '2')).toBe(true);
    expect(calls).toEqual([['forget', { id: 2 }]]);
  });

  it('says false when the brain refuses the delete', async () => {
    const { invoke } = setup(() => Promise.reject(new RpcError(-32003, 'no memory with id 2.')));
    expect(await invoke(IPC.deleteMemory, '2')).toBe(false);
  });

  it('says false for an id the brain cannot have issued, without asking it', async () => {
    const { invoke, calls } = setup(() => []);
    expect(await invoke(IPC.deleteMemory, 'm1')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('lets an offline brain reject, so the view can say it could not read or delete', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.listMemories)).rejects.toBeInstanceOf(BrainOffline);
    await expect(invoke(IPC.deleteMemory, '2')).rejects.toBeInstanceOf(BrainOffline);
  });

  it('rejects a list the brain answered with something that is not memories', async () => {
    const { invoke } = setup(() => text({ nope: true }));
    await expect(invoke(IPC.listMemories)).rejects.toThrow('brain sent bad memories');
  });

  it('handles its two channels and nothing else', () => {
    expect(setup(() => []).channels()).toEqual([IPC.deleteMemory, IPC.listMemories].sort());
  });
});
