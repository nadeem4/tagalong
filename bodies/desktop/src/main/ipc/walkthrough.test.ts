/** Tests for the walkthrough IPC: open resets the seen mark, finish sets it, closing never does. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerWalkthroughIpc } from './walkthrough';

function setup() {
  const ipc = fakeIpc();
  const saved: unknown[] = [];
  const opened: (number | undefined)[] = [];
  let closed = 0;
  registerWalkthroughIpc(ipc.handle, {
    save: (patch) => void saved.push(patch),
    open: (step) => void opened.push(step),
    close: () => void (closed += 1),
  });
  return { ...ipc, saved, opened, closed: () => closed };
}

describe('registerWalkthroughIpc', () => {
  it('open sets done false and opens the window at the step', async () => {
    const { invoke, saved, opened } = setup();
    await invoke(IPC.walkthroughOpen, { step: 9 });
    expect(saved).toEqual([{ walkthrough: { done: false } }]);
    expect(opened).toEqual([9]);
  });

  it('open without a step opens at the start; a bad step is ignored', async () => {
    const { invoke, opened } = setup();
    await invoke(IPC.walkthroughOpen, {});
    await invoke(IPC.walkthroughOpen, undefined);
    await invoke(IPC.walkthroughOpen, { step: 'nine' });
    await invoke(IPC.walkthroughOpen, { step: 0 });
    expect(opened).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('finish sets done true and closes', async () => {
    const { invoke, saved, closed } = setup();
    await invoke(IPC.walkthroughFinish);
    expect(saved).toEqual([{ walkthrough: { done: true } }]);
    expect(closed()).toBe(1);
  });

  it('finish with close: false sets done and leaves the window open', async () => {
    const { invoke, saved, closed } = setup();
    await invoke(IPC.walkthroughFinish, { close: false });
    expect(saved).toEqual([{ walkthrough: { done: true } }]);
    expect(closed()).toBe(0);
  });

  it('closing the window does not set done', async () => {
    // Closing is the window's own event; only finish writes done: true.
    const { invoke, saved } = setup();
    await invoke(IPC.walkthroughOpen, { step: 1 });
    expect(saved).not.toContainEqual({ walkthrough: { done: true } });
  });
});
