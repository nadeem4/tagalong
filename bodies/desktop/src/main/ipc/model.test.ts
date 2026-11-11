/** Tests for the model IPC: Settings reads and picks Scout's model through the brain's Home tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerModelIpc } from './model';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const STATE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  default: 'claude-opus-5-5',
  models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', line: 'Most capable' }],
};

function setup() {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(text(tool === 'model_state' ? STATE : {})) as Promise<never>;
    },
  };
  registerModelIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerModelIpc', () => {
  it('reads the state and parses it', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.modelState)).toEqual(STATE);
    expect(calls).toEqual([['model_state', {}]]);
  });

  it('passes a model id to set_model', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.modelSet, 'claude-sonnet-5-5');
    expect(calls).toEqual([['set_model', { model: 'claude-sonnet-5-5' }]]);
  });

  it('refuses an empty or odd model before the brain hears of it', async () => {
    const { invoke, calls } = setup();
    for (const bad of ['', undefined, 5, null]) {
      await expect(invoke(IPC.modelSet, bad)).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });
});
