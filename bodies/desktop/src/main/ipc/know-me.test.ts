/** Tests for the get-to-know-me IPC: the sources, the start with its refusals, and the status push. */

import { describe, expect, it, vi } from 'vitest';
import { BrainOffline, RpcError } from '@tagalong/contract';
import type { KnowMeStartParams, KnowMeStatusParams } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerKnowMeIpc } from './know-me';

const MB = 1024 * 1024;

function setup(
  options: {
    start?: (params: KnowMeStartParams) => Promise<{ joined: boolean }>;
    sources?: unknown;
  } = {},
) {
  const ipc = fakeIpc();
  const toolCalls: string[] = [];
  const starts: KnowMeStartParams[] = [];
  let listener: ((s: KnowMeStatusParams) => void) | null = null;
  const unsubscribe = vi.fn();
  const broadcast = vi.fn();
  const brain = {
    call: (tool: string) => {
      toolCalls.push(tool);
      return Promise.resolve([
        { type: 'text' as const, text: JSON.stringify(options.sources ?? []) },
      ]) as Promise<never>;
    },
    knowMeStart: (params: KnowMeStartParams) => {
      starts.push(params);
      return (options.start ?? (() => Promise.resolve({ joined: false })))(params);
    },
    onKnowMeStatus: (l: (s: KnowMeStatusParams) => void) => {
      listener = l;
      return unsubscribe;
    },
  };
  registerKnowMeIpc(ipc.handle, { brain, broadcast });
  return { ...ipc, toolCalls, starts, broadcast, push: (s: unknown) => listener?.(s as never) };
}

/** base64 of `bytes` zero bytes. */
const b64 = (bytes: number): string => Buffer.alloc(bytes).toString('base64');

describe('registerKnowMeIpc', () => {
  it('lists the sources from the brain tool', async () => {
    const sources = [{ name: 'GitHub', needs: 'username', label: 'Your GitHub username' }];
    const { invoke, toolCalls } = setup({ sources });
    expect(await invoke(IPC.knowMeSources)).toEqual(sources);
    expect(toolCalls).toEqual(['know_me_sources']);
  });

  it('refuses sources the brain sent in a shape it does not know', async () => {
    const { invoke } = setup({ sources: [{ name: 'GitHub', needs: 'telepathy', label: 'x' }] });
    await expect(invoke(IPC.knowMeSources)).rejects.toThrow('brain sent bad know_me_sources');
  });

  it('starts a run and says whether it joined one', async () => {
    const { invoke, starts } = setup({ start: () => Promise.resolve({ joined: true }) });
    expect(await invoke(IPC.knowMeStart, { github: 'octo' })).toEqual({ joined: true });
    expect(starts).toEqual([{ github: 'octo' }]);
  });

  it('refuses a start with no input, without asking the brain', async () => {
    const { invoke, starts } = setup();
    expect(await invoke(IPC.knowMeStart, {})).toEqual({
      error: 'Give a GitHub username or a LinkedIn PDF.',
    });
    expect(starts).toEqual([]);
  });

  it('refuses a pdf over 10 MB decoded before calling the brain', async () => {
    const { invoke, starts } = setup();
    const result = await invoke(IPC.knowMeStart, {
      pdf: { name: 'cv.pdf', data: b64(10 * MB + 1) },
    });
    expect(result).toEqual({ error: 'That PDF is over 10 MB.' });
    expect(starts).toEqual([]);
  });

  it('passes a pdf of exactly 10 MB', async () => {
    const { invoke, starts } = setup();
    await invoke(IPC.knowMeStart, { pdf: { name: 'cv.pdf', data: b64(10 * MB) } });
    expect(starts).toHaveLength(1);
  });

  it('says the pdf is too big when the brain says over_limit', async () => {
    const { invoke } = setup({
      start: () => Promise.reject(new RpcError(-32008, 'The PDF is over 10 MB.')),
    });
    expect(await invoke(IPC.knowMeStart, { pdf: { name: 'cv.pdf', data: 'AAAA' } })).toEqual({
      error: 'That PDF is over 10 MB.',
    });
  });

  it('says plainly when the brain is away', async () => {
    const { invoke } = setup({ start: () => Promise.reject(new BrainOffline()) });
    expect(await invoke(IPC.knowMeStart, { github: 'octo' })).toEqual({
      error: 'Scout is not connected right now.',
    });
  });

  it('passes the brain refusal text for any other rejected start', async () => {
    const { invoke } = setup({
      start: () => Promise.reject(new RpcError(-32602, 'Not a GitHub username.')),
    });
    expect(await invoke(IPC.knowMeStart, { github: 'octo' })).toEqual({
      error: 'Not a GitHub username.',
    });
  });

  it('pushes each status frame to every window', () => {
    const { push, broadcast } = setup();
    const status = { sources: [{ name: 'GitHub', state: 'reading' }], done: false };
    push(status);
    expect(broadcast).toHaveBeenCalledWith(IPC.knowMeStatusEvent, status);
  });

  it('drops a bad status frame', () => {
    const { push, broadcast } = setup();
    push({ sources: [{ name: 'GitHub', state: 'paused' }], done: false });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('handles its two channels and nothing else', () => {
    expect(setup().channels()).toEqual([IPC.knowMeSources, IPC.knowMeStart].sort());
  });
});
