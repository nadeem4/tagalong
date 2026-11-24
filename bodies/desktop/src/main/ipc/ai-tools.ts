/**
 * IPC behind "Connect another AI tool": the brain sets Claude Code, Codex or Cursor up on this
 * PC (connect_ai_tool, which can take most of a minute), or makes the one-time link to do it by
 * hand (mcp_client_make). Contains registerAiToolIpc.
 */
import { AI_TOOLS } from '@tagalong/ui/shapes';
import type { AiToolConnect, AiToolLink } from '@tagalong/ui/shapes';
import { ErrorCode, RpcError } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

// A little over the brain's own 90 s wait for the desktop.
const CONNECT_WAIT_MS = 90_000;

const known = (tool: string): boolean => AI_TOOLS.some((entry) => entry.id === tool);

export function registerAiToolIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.aiToolConnect, async (_event, tool: string): Promise<AiToolConnect> => {
    if (!known(tool)) throw new Error('unknown AI tool');
    try {
      const parts = await brain.call('connect_ai_tool', { tool }, CONNECT_WAIT_MS);
      const part = parts.find((p) => p.type === 'text');
      return { ok: true, text: part?.type === 'text' ? part.text : '' };
    } catch (error) {
      if (error instanceof RpcError) return { ok: false, message: error.message };
      throw error;
    }
  });
  handle(IPC.aiToolLink, async (_event, tool: string, personal: boolean): Promise<AiToolLink> => {
    if (!known(tool)) throw new Error('unknown AI tool');
    try {
      const made = (await callJson(brain, 'mcp_client_make', { name: tool, personal })) as {
        link: string;
        expires_at: string;
      };
      return { link: made.link, expiresAt: made.expires_at };
    } catch (error) {
      const off = error instanceof RpcError && error.code === ErrorCode.network_off;
      throw new Error(off ? 'network_off' : 'failed', { cause: error });
    }
  });
}
