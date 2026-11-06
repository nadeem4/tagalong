/** Tests for the askScout IPC: Home hands text to the companion, which asks it as the person. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { registerAskScoutIpc } from './ask-scout';
import { fakeIpc } from './fake-ipc';

const HOME = { home: true };

function setup() {
  const ipc = fakeIpc();
  const steps: string[] = [];
  registerAskScoutIpc(ipc.handle, {
    fromHome: (event) => (event as { home?: boolean }).home === true,
    bringUp: () => steps.push('up'),
    send: (text) => steps.push(`send ${text}`),
  });
  return { ...ipc, steps };
}

describe('registerAskScoutIpc', () => {
  it('brings up the bubble and forwards the text to the panel once', async () => {
    const { invokeWith, steps } = setup();
    await invokeWith(HOME, IPC.askScout, 'Fix text from pictures');
    expect(steps).toEqual(['up', 'send Fix text from pictures']);
  });

  it('ignores empty or non-text asks', async () => {
    const { invokeWith, steps } = setup();
    await invokeWith(HOME, IPC.askScout, '   ');
    await invokeWith(HOME, IPC.askScout, 42);
    expect(steps).toEqual([]);
  });

  it('ignores a call from any window but Home', async () => {
    const { invokeWith, steps } = setup();
    await invokeWith({ home: false }, IPC.askScout, 'Fix text from pictures');
    expect(steps).toEqual([]);
  });
});
