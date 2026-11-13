/** Tests for the What Scout remembers IPC, which reads and deletes through the brain's tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { BrainOffline, RpcError } from '@tagalong/contract';
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
          { id: 3, kind: 'instruction', text: 'Short answers.', at: AT },
          { id: 2, kind: 'about_you', text: 'Works on Tagalong', at: AT },
          { id: 1, kind: 'summary', text: 'Talked about launch.', at: AT },
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

  it('maps a profile fact to a fact and keeps where it came from', async () => {
    const { invoke } = setup(() =>
      text({
        memories: [
          {
            id: 4,
            kind: 'profile',
            text: 'Software engineer',
            at: AT,
            tag: 'work',
            source: 'linkedin',
            source_ref: 'cv.pdf',
            evidence: 'Software Engineer at Acme',
            visibility: 'free',
          },
          { id: 5, kind: 'about_you', text: 'Likes tea', at: AT, tag: null, source: 'chat' },
        ],
        portrait: 'You build things.',
      }),
    );
    expect(await invoke(IPC.listMemories)).toEqual([
      {
        id: '4',
        kind: 'fact',
        text: 'Software engineer',
        createdAt: AT,
        tag: 'work',
        source: 'linkedin',
        sourceRef: 'cv.pdf',
        evidence: 'Software Engineer at Acme',
        visibility: 'free',
      },
      { id: '5', kind: 'fact', text: 'Likes tea', createdAt: AT, source: 'chat' },
    ]);
  });

  it('maps category and span, omitting nulls', async () => {
    const { invoke } = setup(() =>
      text({
        memories: [
          {
            id: 6,
            kind: 'about_you',
            text: 'Senior engineer',
            at: AT,
            category: 'Work',
            span_start: '2019',
            span_end: null,
          },
          { id: 7, kind: 'about_you', text: 'Old row', at: AT, category: null, span_start: null },
        ],
      }),
    );
    expect(await invoke(IPC.listMemories)).toEqual([
      {
        id: '6',
        kind: 'fact',
        text: 'Senior engineer',
        createdAt: AT,
        category: 'Work',
        spanStart: '2019',
      },
      { id: '7', kind: 'fact', text: 'Old row', createdAt: AT },
    ]);
  });

  it('reads the portrait from the same brain call, or null when there is none', async () => {
    const withPortrait = setup(() => text({ memories: [], portrait: 'You build things.' }));
    expect(await withPortrait.invoke(IPC.getPortrait)).toBe('You build things.');
    expect(withPortrait.calls).toEqual([['list_memories', {}]]);
    const without = setup(() => text({ memories: [], portrait: null }));
    expect(await without.invoke(IPC.getPortrait)).toBeNull();
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

  it('handles its three channels and nothing else', () => {
    expect(setup(() => []).channels()).toEqual(
      [IPC.deleteMemory, IPC.getPortrait, IPC.listMemories].sort(),
    );
  });
});
