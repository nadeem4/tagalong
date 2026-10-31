/** Tests for the turn IPC: ask and interrupt go to the brain. */

import { describe, expect, it } from 'vitest';
import type { SayParams } from '@tagalong/contract';
import type { ContextSnapshot } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '@tagalong/contract';
import { fakeIpc } from './fake-ipc';
import { registerTurnIpc } from './turns';

function setup(
  snapshot: Partial<ContextSnapshot> | null = null,
  options: {
    offline?: boolean;
    outdated?: boolean;
    joined?: boolean;
    takeDrop?: () => Promise<never>;
    voiceOn?: boolean;
  } = {},
) {
  const ipc = fakeIpc();
  const said: SayParams[] = [];
  const cancelled: string[] = [];
  const claimed: string[] = [];
  const stopped: string[] = [];
  registerTurnIpc(ipc.handle, {
    brain: {
      say: (params) => {
        said.push(params);
        return options.offline === true
          ? Promise.reject(new BrainOffline())
          : Promise.resolve({ turn: 't1', joined: options.joined === true });
      },
      cancel: (turn) => void cancelled.push(turn),
    },
    claimTurn: (turn) => void claimed.push(turn),
    stopVoice: () => void stopped.push('voice'),
    voice: () => ({ enabled: options.voiceOn !== false, voice: 'bm_george', speed: 0.95 }),
    status: () => (options.outdated === true ? 'outdated' : 'online'),
    pendingSnapshot: () => snapshot as ContextSnapshot | null,
    ...(options.takeDrop ? { takeDrop: options.takeDrop } : {}),
  });
  return { ...ipc, said, cancelled, claimed, stopped };
}

describe('registerTurnIpc', () => {
  it('interrupt cancels the turn and stops its speech', async () => {
    const { invoke, cancelled, stopped } = setup();
    await invoke(IPC.interrupt, 't1');
    expect(cancelled).toEqual(['t1']);
    expect(stopped).toEqual(['voice']);
  });

  it('ask sends say with text and returns turnId', async () => {
    const { invoke, said } = setup();
    expect(await invoke(IPC.ask, { petId: 'scout', text: 'hi', spoken: true })).toEqual({
      turnId: 't1',
    });
    expect(said).toEqual([{ text: 'hi', spoken: true, voice: 'bm_george', speed: 0.95 }]);
  });

  it('a spoken ask with Scout talks switched off is asked as text', async () => {
    const { invoke, said } = setup(null, { voiceOn: false });
    await invoke(IPC.ask, { petId: 'scout', text: 'hi', spoken: true });
    expect(said).toEqual([{ text: 'hi' }]);
  });

  it('ask that joins a running turn claims it, so a quiet wake turn shows', async () => {
    const joined = setup(null, { joined: true });
    expect(await joined.invoke(IPC.ask, { petId: 'scout', text: 'hi' })).toEqual({ turnId: 't1' });
    expect(joined.claimed).toEqual(['t1']);

    const fresh = setup();
    await fresh.invoke(IPC.ask, { petId: 'scout', text: 'hi' });
    expect(fresh.claimed).toEqual([]);
  });

  it('ask with a pending snapshot sends the window title as context', async () => {
    const { invoke, said } = setup({ app: { name: 'Code', windowTitle: 'a.ts' } });
    await invoke(IPC.ask, { petId: 'scout', text: 'what is this?' });
    expect(said).toEqual([
      {
        text: 'what is this?',
        context: { window: 'a.ts' },
      },
    ]);
  });

  it('ask when the brain is too new rejects with the update sentence', async () => {
    const { invoke } = setup(null, { outdated: true, offline: true });
    await expect(invoke(IPC.ask, { petId: 'scout', text: 'hi' })).rejects.toThrow(
      'Update Tagalong to talk to this brain.',
    );
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
      { text: 'Explain this.', parts: [{ type: 'text', text: 'a.md\n\nabc' }] },
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
