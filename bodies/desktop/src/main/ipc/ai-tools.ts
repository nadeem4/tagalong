/**
 * IPC behind "Connect another AI tool": the brain sets Claude Code, Codex or Cursor up on this
 * PC (connect_ai_tool, which can take most of a minute), or makes the one-time link to do it by
 * hand (mcp_client_make). Contains registerAiToolIpc.
 */
import { AI_TOOLS } from '@tagalong/ui/shapes';
import type { AiToolConnect, AiToolLinkResult } from '@tagalong/ui/shapes';
import { RpcError } from '@tagalong/contract';
import { IPC } from '../../shared/ipc';
import { callJson, callText, linkFailure } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

// Above the brain's own wait (CONNECT_AI_TOOL_TIMEOUT_S, 90 s), so its answer or refusal lands first.
const CONNECT_WAIT_MS = 100_000;

const known = (tool: string): boolean => AI_TOOLS.some((entry) => entry.id === tool);

export function registerAiToolIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.aiToolConnect, async (_event, tool: string): Promise<AiToolConnect> => {
    if (!known(tool)) throw new Error('unknown AI tool');
    try {
      return {
        ok: true,
        text: await callText(brain, 'connect_ai_tool', { tool }, CONNECT_WAIT_MS),
      };
    } catch (error) {
      if (error instanceof RpcError) return { ok: false, message: error.message };
      throw error;
    }
  });
  handle(
    IPC.aiToolLink,
    async (_event, tool: string, personal: boolean): Promise<AiToolLinkResult> => {
      if (!known(tool)) throw new Error('unknown AI tool');
      try {
        const made = (await callJson(brain, 'mcp_client_make', { name: tool, personal })) as {
          link: string;
        };
        return { ok: true, link: made.link };
      } catch (error) {
        return { ok: false, reason: linkFailure(error) };
      }
    },
  );
}
