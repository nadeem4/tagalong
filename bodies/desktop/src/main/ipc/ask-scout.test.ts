/** Tests for the askScout IPC: Home hands text to the companion, which asks it as the person. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerAskScoutIpc } from './ask-scout';
import { fakeIpc } from './fake-ipc';

function setup() {
  const ipc = fakeIpc();
  const steps: string[] = [];
  registerAskScoutIpc(ipc.handle, {
    bringUp: () => steps.push('up'),
    send: (text) => steps.push(`send ${text}`),
  });
  return { ...ipc, steps };
}

describe('registerAskScoutIpc', () => {
  it('brings up the bubble and forwards the text to the panel once', async () => {
    const { invoke, steps } = setup();
    await invoke(IPC.askScout, 'Fix text from pictures');
    expect(steps).toEqual(['up', 'send Fix text from pictures']);
  });

  it('ignores empty or non-text asks', async () => {
    const { invoke, steps } = setup();
    await invoke(IPC.askScout, '   ');
    await invoke(IPC.askScout, 42);
    expect(steps).toEqual([]);
  });
});
