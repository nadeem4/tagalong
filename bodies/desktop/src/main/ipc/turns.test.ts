/** Tests for the turn IPC: ask and interrupt go to the brain. */

import { describe, expect, it } from 'vitest';
import type { SayParams } from '@tagalong/contract';
import type { ContextSnapshot } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '@tagalong/contract';
import { fakeIpc } from './fake-ipc';
import { ASK_SELECTION_MAX_CHARS, registerTurnIpc } from './turns';

function setup(
  snapshot: Partial<ContextSnapshot> | null = null,
  options: {
    offline?: boolean;
    outdated?: boolean;
    takeDrop?: () => Promise<never>;
    voiceOn?: boolean;
  } = {},
) {
  const ipc = fakeIpc();
  let current = snapshot;
  const said: SayParams[] = [];
  const cancelled: string[] = [];
  const tracked: string[] = [];
  const untracked: string[] = [];
  const stopped: string[] = [];
  registerTurnIpc(ipc.handle, {
    brain: {
      say: (params) => {
        said.push(params);
        return options.offline === true ? Promise.reject(new BrainOffline()) : Promise.resolve({});
      },
      cancel: (turn) => void cancelled.push(turn),
    },
    trackSay: (id) => void tracked.push(id),
    untrackSay: (id) => void untracked.push(id),
    stopVoice: () => void stopped.push('voice'),
    voice: () => ({ enabled: options.voiceOn !== false, speed: 0.95 }),
    status: () => (options.outdated === true ? 'outdated' : 'online'),
    pendingSnapshot: () => current as ContextSnapshot | null,
    clearSelection: () => {
      if (current !== null) current = { ...current, selection: undefined };
    },
    ...(options.takeDrop ? { takeDrop: options.takeDrop } : {}),
  });
  return { ...ipc, said, cancelled, tracked, untracked, stopped };
}

const UUID = /^[0-9a-f-]{36}$/;

describe('registerTurnIpc', () => {
  it('interrupt cancels the turn and stops its speech', async () => {
    const { invoke, cancelled, stopped } = setup();
    await invoke(IPC.interrupt, 't1');
    expect(cancelled).toEqual(['t1']);
    expect(stopped).toEqual(['voice']);
  });

  it('ask sends say with an id, text and speech, and answers nothing', async () => {
    const { invoke, said } = setup();
    expect(await invoke(IPC.ask, { petId: 'scout', text: 'hi', spoken: true })).toBeUndefined();
    expect(said).toEqual([
      { id: expect.stringMatching(UUID), text: 'hi', spoken: true, speed: 0.95 },
    ]);
  });

  it('sends a fresh id with every say, and tracks it before sending', async () => {
    const { invoke, said, tracked } = setup();
    await invoke(IPC.ask, { petId: 'scout', text: 'one' });
    await invoke(IPC.ask, { petId: 'scout', text: 'two' });
    expect(said[0]!.id).not.toBe(said[1]!.id);
    expect(tracked).toEqual([said[0]!.id, said[1]!.id]);
  });

  it('an interrupted ask carries it to the brain, and only that ask', async () => {
    const { invoke, said } = setup();
    await invoke(IPC.ask, {
      petId: 'scout',
      text: 'wait',
      spoken: true,
      interrupted: { turn: 't0', heard: 2 },
    });
    await invoke(IPC.ask, { petId: 'scout', text: 'and then?', spoken: true });
    expect(said[0]).toMatchObject({ text: 'wait', interrupted: { turn: 't0', heard: 2 } });
    expect(said[1]).not.toHaveProperty('interrupted');
  });

  it('a spoken ask with Scout talks switched off is asked as text', async () => {
    const { invoke, said } = setup(null, { voiceOn: false });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi', spoken: true });
    expect(said).toEqual([{ id: expect.stringMatching(UUID), text: 'hi' }]);
  });

  it('ask with a pending snapshot sends the window title as context', async () => {
    const { invoke, said } = setup({ app: { name: 'Code', windowTitle: 'a.ts' } });
    await invoke(IPC.ask, { petId: 'scout', text: 'what is this?' });
    expect(said).toEqual([
      {
        id: expect.stringMatching(UUID),
        text: 'what is this?',
        context: { window: 'a.ts' },
      },
    ]);
  });

  it('ask with a selection sends it beside the window', async () => {
    const { invoke, said } = setup({
      app: { name: 'Code', windowTitle: 'a.ts' },
      selection: 'the highlighted words',
    });
    await invoke(IPC.ask, { petId: 'scout', text: 'what does this say?' });
    expect(said[0]!.context).toEqual({ window: 'a.ts', selection: 'the highlighted words' });
  });

  it('ask with no selection sends only the window', async () => {
    const { invoke, said } = setup({ app: { name: 'Code', windowTitle: 'a.ts' } });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(said[0]!.context).toEqual({ window: 'a.ts' });
  });

  it('ask with no snapshot sends no context', async () => {
    const { invoke, said } = setup(null);
    await invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(said[0]).not.toHaveProperty('context');
  });

  it('a selection over the cap is cut and marked', async () => {
    const { invoke, said } = setup({ selection: 'x'.repeat(ASK_SELECTION_MAX_CHARS + 50) });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(said[0]!.context).toEqual({
      selection: 'x'.repeat(ASK_SELECTION_MAX_CHARS) + '…[cut]',
    });
  });

  it('the selection goes with one ask only; a follow-up carries the window alone', async () => {
    const { invoke, said } = setup({
      app: { name: 'Code', windowTitle: 'a.ts' },
      selection: 'abc',
    });
    await invoke(IPC.ask, { petId: 'scout', text: 'one' });
    await invoke(IPC.ask, { petId: 'scout', text: 'two' });
    expect(said[0]!.context).toEqual({ window: 'a.ts', selection: 'abc' });
    expect(said[1]!.context).toEqual({ window: 'a.ts' });
  });

  it('a selection of exactly the cap is not cut', async () => {
    const { invoke, said } = setup({ selection: 'x'.repeat(ASK_SELECTION_MAX_CHARS) });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(said[0]!.context).toEqual({ selection: 'x'.repeat(ASK_SELECTION_MAX_CHARS) });
  });

  it('a cut never leaves half an emoji', async () => {
    const selection = 'x'.repeat(ASK_SELECTION_MAX_CHARS - 1) + '😀tail';
    const { invoke, said } = setup({ selection });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(said[0]!.context).toEqual({
      selection: 'x'.repeat(ASK_SELECTION_MAX_CHARS - 1) + '…[cut]',
    });
  });

  it('ask when the brain is too new rejects with the update sentence', async () => {
    const { invoke } = setup(null, { outdated: true, offline: true });
    await expect(invoke(IPC.ask, { petId: 'scout', text: 'hi' })).rejects.toThrow(
      'Update Tagalong to talk to this brain.',
    );
  });

  it('a say the brain refuses is untracked', async () => {
    const { invoke, said, tracked, untracked } = setup(null, { offline: true });
    await expect(invoke(IPC.ask, { petId: 'scout', text: 'hi' })).rejects.toThrow();
    expect(untracked).toEqual([said[0]!.id]);
    expect(tracked).toEqual(untracked);
  });

  it('ask when brain offline rejects with the offline sentence', async () => {
    const { invoke } = setup(null, { offline: true });
    await expect(invoke(IPC.ask, { petId: 'scout', text: 'hi' })).rejects.toThrow(
      "Scout's brain is not running",
    );
  });

  it('ask with a dropped item sends it as parts, and a failed read asks nothing', async () => {
    const dropped = { kind: 'file' as const, name: 'a.md', text: 'abc' };
    const ok = setup(null, { takeDrop: () => Promise.resolve(dropped as never) });
    await ok.invoke(IPC.ask, { petId: 'scout', text: 'Explain this.', drop: true });
    expect(ok.said).toEqual([
      {
        id: expect.stringMatching(UUID),
        text: 'Explain this.',
        parts: [{ type: 'text', text: 'a.md\n\nabc' }],
      },
    ]);

    const bad = setup(null, {
      takeDrop: () => Promise.reject(new Error('Couldn’t read gone.md.')),
    });
    await expect(bad.invoke(IPC.ask, { petId: 'scout', text: 'x', drop: true })).rejects.toThrow(
      'gone.md',
    );
    expect(bad.said).toEqual([]);
  });

  it('interrupt sends cancel', async () => {
    const { invoke, cancelled } = setup();
    await invoke(IPC.interrupt, 't1');
    expect(cancelled).toEqual(['t1']);
  });
});
