/** Tests for the key IPC: the key passes through once, and no reply or error carries it back. */

import { BrainOffline, RpcError } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerKeyIpc } from './key';

const FAKE_KEY = 'sk-ant-example-not-a-real-key';
const text = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];

function setup(reply: () => unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(reply() as never);
    },
  };
  registerKeyIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerKeyIpc', () => {
  it('key:status maps key_status', async () => {
    const { invoke, calls } = setup(() =>
      text({ has_key: true, source: 'file', env_path: 'C:/home/.env', daily_limit_usd: 5 }),
    );
    expect(await invoke(IPC.keyStatus)).toEqual({
      hasKey: true,
      source: 'file',
      envPath: 'C:/home/.env',
      dailyLimitUsd: 5,
    });
    expect(calls).toEqual([['key_status', {}]]);
  });

  it('key:status rejects an answer it cannot read', async () => {
    const { invoke } = setup(() => text({ nope: true }));
    await expect(invoke(IPC.keyStatus)).rejects.toThrow('brain sent bad key status');
  });

  it('key:set forwards the string once and returns only ok|invalid|unreachable', async () => {
    const { invoke, calls } = setup(() =>
      text({ status: 'invalid', message: 'secret provider text', key: FAKE_KEY }),
    );
    expect(await invoke(IPC.keySet, FAKE_KEY)).toBe('invalid');
    expect(calls).toEqual([['set_api_key', { key: FAKE_KEY }]]);
    for (const status of ['ok', 'unreachable']) {
      const again = setup(() => text({ status }));
      expect(await again.invoke(IPC.keySet, FAKE_KEY)).toBe(status);
    }
  });

  it('key:set returns offline when the brain call rejects as not connected', async () => {
    const ipc = fakeIpc();
    registerKeyIpc(ipc.handle, { brain: { call: () => Promise.reject(new BrainOffline()) } });
    expect(await ipc.invoke(IPC.keySet, FAKE_KEY)).toBe('offline');
  });

  it('key:set never puts the key in a thrown error', async () => {
    const ipc = fakeIpc();
    registerKeyIpc(ipc.handle, {
      brain: { call: () => Promise.reject(new Error(`boom with ${FAKE_KEY}`)) },
    });
    const failure = await ipc.invoke(IPC.keySet, FAKE_KEY).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).not.toContain(FAKE_KEY);

    const rpc = fakeIpc();
    registerKeyIpc(rpc.handle, {
      brain: { call: () => Promise.reject(new RpcError(-32602, 'set_api_key needs a key.')) },
    });
    await expect(rpc.invoke(IPC.keySet, '')).rejects.toThrow('set_api_key needs a key.');

    const odd = setup(() => text({ status: 'weird' }));
    const bad = await odd.invoke(IPC.keySet, FAKE_KEY).catch((e: unknown) => e as Error);
    expect(String((bad as Error).message)).not.toContain(FAKE_KEY);
  });

  it('limit:set forwards usd', async () => {
    const { invoke, calls } = setup(() => text({ daily_limit_usd: 8 }));
    await invoke(IPC.limitSet, 8);
    expect(calls).toEqual([['set_daily_limit', { usd: 8 }]]);
  });

  it('expert:status maps expert_status', async () => {
    const { invoke, calls } = setup(() => text({ found: true, command: 'claude-agent-acp' }));
    expect(await invoke(IPC.expertStatus)).toEqual({ found: true, command: 'claude-agent-acp' });
    expect(calls).toEqual([['expert_status', {}]]);
  });
});
