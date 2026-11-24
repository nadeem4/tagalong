/**
 * Tests for the AI tool IPC: connecting asks the brain with a long wait and turns a refusal into
 * its sentence, and the by-hand link asks for a client named for the tool.
 */
import { describe, expect, it } from 'vitest';
import { ErrorCode, RpcError } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerAiToolIpc } from './ai-tools';

const text = (value: string) => [{ type: 'text' as const, text: value }];

function setup(answer: (tool: string, input?: object) => unknown) {
  const ipc = fakeIpc();
  const calls: [string, object | undefined, number | undefined][] = [];
  registerAiToolIpc(ipc.handle, {
    brain: {
      call: (tool: string, input?: object, timeoutMs?: number) => {
        calls.push([tool, input, timeoutMs]);
        try {
          return Promise.resolve(answer(tool, input)) as Promise<never>;
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
    },
  });
  return { ...ipc, calls };
}

describe('registerAiToolIpc', () => {
  it('connects a tool, waiting longer than a usual call', async () => {
    const { invoke, calls } = setup(() => text("Cursor is connected to Scout's memory."));
    expect(await invoke(IPC.aiToolConnect, 'cursor')).toEqual({
      ok: true,
      text: "Cursor is connected to Scout's memory.",
    });
    expect(calls).toEqual([['connect_ai_tool', { tool: 'cursor' }, 100_000]]);
  });

  it('hands back the reason when the brain refuses', async () => {
    const { invoke } = setup(() => {
      throw new RpcError(ErrorCode.tool_failed, 'Codex is not installed on this PC.');
    });
    expect(await invoke(IPC.aiToolConnect, 'codex')).toEqual({
      ok: false,
      message: 'Codex is not installed on this PC.',
    });
  });

  it('makes a link for a client named for the tool, and says when the network is off', async () => {
    const { invoke, calls } = setup(() =>
      text(
        JSON.stringify({
          name: 'codex',
          link: 'tagalong://pair?c=1',
          expires_at: 'T',
          personal: true,
        }),
      ),
    );
    expect(await invoke(IPC.aiToolLink, 'codex', true)).toEqual({
      ok: true,
      link: 'tagalong://pair?c=1',
    });
    expect(calls).toEqual([['mcp_client_make', { name: 'codex', personal: true }, undefined]]);

    const off = setup(() => {
      throw new RpcError(ErrorCode.network_off, 'off');
    });
    expect(await off.invoke(IPC.aiToolLink, 'codex', false)).toEqual({
      ok: false,
      reason: 'network_off',
    });
  });

  it('refuses a tool it does not know', async () => {
    const { invoke, calls } = setup(() => text('x'));
    await expect(invoke(IPC.aiToolConnect, 'notepad')).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
