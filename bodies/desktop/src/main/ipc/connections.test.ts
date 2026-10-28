/** Tests for the connected-app IPC: Home's apps go through the brain's tools, asks are answered. */

import { ErrorCode } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { BrainOffline, RpcError } from '../brain/brain-client';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { forwardAppsChanged, registerConnectionIpc } from './connections';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const APP = {
  id: 'files',
  name: 'Files',
  transport: 'stdio',
  auth: 'none',
  enabled: true,
  status: 'connected',
  error: '',
  tools: [{ name: 'files__read', effect: 'read', locked: false }],
};

function setup(answer: (tool: string, input?: object) => Promise<unknown> | unknown = () => []) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(answer(tool, input)) as Promise<never>;
    },
  };
  const answers: [string, string][] = [];
  const replies: [string, string, string | undefined][] = [];
  registerConnectionIpc(ipc.handle, {
    brain,
    answer: (ask, decision) => {
      answers.push([ask, decision]);
      return Promise.resolve();
    },
    reply: (ask, option, text) => {
      replies.push([ask, option, text]);
      return Promise.resolve();
    },
  });
  return { ...ipc, calls, answers, replies };
}

describe('registerConnectionIpc', () => {
  it("answers a Claude Code job's ask by option name, with typed text when given", async () => {
    const { invoke, replies } = setup();
    await invoke(IPC.answerJobAsk, 'a1', { option: 'Edit' });
    await invoke(IPC.answerJobAsk, 'a2', { option: 'duckdb', text: 'duckdb' });
    expect(replies).toEqual([
      ['a1', 'Edit', undefined],
      ['a2', 'duckdb', 'duckdb'],
    ]);
  });

  it("answers Scout's ask on the brain", async () => {
    const { invoke, calls, answers } = setup();
    await invoke(IPC.approveTool, 'a1', 'once');
    await invoke(IPC.approveTool, 'a2', 'always');
    await invoke(IPC.approveTool, 'a3', 'deny');
    expect(answers).toEqual([
      ['a1', 'once'],
      ['a2', 'always'],
      ['a3', 'deny'],
    ]);
    expect(calls).toEqual([]);
  });

  const failing = (error: Error) => {
    const ipc = fakeIpc();
    registerConnectionIpc(ipc.handle, {
      brain: { call: () => Promise.resolve([]) },
      answer: () => Promise.reject(error),
      reply: () => Promise.reject(error),
    });
    return ipc;
  };

  it('a job ask the brain no longer has does not throw into the card either', async () => {
    const ipc = failing(new RpcError(ErrorCode.not_found, 'no open ask'));
    await expect(ipc.invoke(IPC.answerJobAsk, 'a1', { option: 'Edit' })).resolves.toBeUndefined();
  });

  it('an ask the brain no longer has (not_found) does not throw into the card', async () => {
    const ipc = failing(new RpcError(ErrorCode.not_found, 'no open ask'));
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).resolves.toBeUndefined();
  });

  it('an offline brain rejects, so the card stays up for another click', async () => {
    const ipc = failing(new BrainOffline());
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).rejects.toThrow('brain offline');
  });

  it('any other refusal rejects too', async () => {
    const ipc = failing(new RpcError(ErrorCode.tool_failed, 'boom'));
    await expect(ipc.invoke(IPC.approveTool, 'a1', 'once')).rejects.toThrow('boom');
  });

  it('lists the apps through list_apps and returns the parsed list', async () => {
    const { invoke, calls } = setup(() => text({ apps: [APP] }));
    expect(await invoke(IPC.listConnections)).toEqual({ apps: [APP] });
    expect(calls).toEqual([['list_apps', {}]]);
  });

  it('rejects a list that is not apps', async () => {
    const { invoke } = setup(() => text({ apps: 'nope' }));
    await expect(invoke(IPC.listConnections)).rejects.toThrow();
  });

  it('adds an app with the validated params', async () => {
    const { invoke, calls } = setup(() => text({ id: 'files' }));
    const added = await invoke(IPC.addConnection, {
      name: 'Files',
      transport: 'stdio',
      command: 'npx',
    });
    expect(added).toEqual({ id: 'files' });
    expect(calls).toEqual([
      ['add_app', { name: 'Files', transport: 'stdio', command: 'npx', auth: 'none' }],
    ]);
  });

  it('refuses params that do not parse, before any brain call', async () => {
    const { invoke, calls } = setup();
    await expect(invoke(IPC.addConnection, { name: '' })).rejects.toThrow();
    await expect(invoke(IPC.addConnection, { name: 'X', transport: 'http' })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('enables, disables, removes and restarts through the brain tools', async () => {
    const { invoke, calls } = setup(() => text({ ok: true }));
    await invoke(IPC.setConnectionEnabled, 'files', false);
    await invoke(IPC.removeConnection, 'files');
    await invoke(IPC.restartConnection, 'files');
    expect(calls).toEqual([
      ['set_app_enabled', { id: 'files', enabled: false }],
      ['remove_app', { id: 'files' }],
      ['restart_app', { id: 'files' }],
    ]);
  });

  it('refuses a bad id or flag without asking the brain', async () => {
    const { invoke, calls } = setup();
    await expect(invoke(IPC.setConnectionEnabled, '', true)).rejects.toThrow();
    await expect(invoke(IPC.setConnectionEnabled, 'files', 'yes')).rejects.toThrow();
    await expect(invoke(IPC.removeConnection, 7)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('signs in through the brain tool', async () => {
    const { invoke, calls } = setup(() => text({ id: 'files', status: 'connecting' }));
    await invoke(IPC.signInConnection, 'files');
    expect(calls).toEqual([['sign_in_app', { id: 'files' }]]);
  });

  it('refuses a bad id for sign-in without asking the brain', async () => {
    const { invoke, calls } = setup();
    await expect(invoke(IPC.signInConnection, 7)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("passes the brain's refusal on, such as no browser to sign in with", async () => {
    const { invoke } = setup(() => {
      throw new RpcError(
        ErrorCode.invalid_params,
        'Open Tagalong on the machine the brain runs on to sign in.',
      );
    });
    await expect(invoke(IPC.signInConnection, 'files')).rejects.toThrow(
      'Open Tagalong on the machine the brain runs on to sign in.',
    );
  });

  it('an offline brain rejects with its readable message, not a hang', async () => {
    const { invoke } = setup(() => Promise.reject(new BrainOffline()));
    await expect(invoke(IPC.listConnections)).rejects.toThrow('brain offline');
    await expect(invoke(IPC.removeConnection, 'files')).rejects.toBeInstanceOf(BrainOffline);
  });

  it('never calls the old engine: only brain tools and asks', async () => {
    const { invoke, calls } = setup(() => text({ apps: [] }));
    await invoke(IPC.listConnections);
    expect(calls.every(([tool]) => !tool.startsWith('connections.'))).toBe(true);
  });
});

describe('forwardAppsChanged', () => {
  it('forwards connections.changed with no payload when the apps changed', () => {
    const sent: unknown[] = [];
    forwardAppsChanged('apps', (n) => sent.push(n));
    expect(sent).toEqual([{ method: 'connections.changed', params: {} }]);
  });

  it('ignores any other change', () => {
    const sent: unknown[] = [];
    forwardAppsChanged('memory', (n) => sent.push(n));
    expect(sent).toEqual([]);
  });
});
