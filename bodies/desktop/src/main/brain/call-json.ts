/**
 * Reads a Home tool's answer: the brain's Home tools return one JSON string in a single text
 * part, so a handler asks for the tool and gets the parsed value, or an error naming the tool.
 * Also maps a brain refusal to the two reasons a screen tells apart.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import type { BrainClient } from '@tagalong/contract';

/** All the IPC handlers need of the brain: run one of its tools. */
export type BrainCall = Pick<BrainClient, 'call'>;

/** The tool's answer as plain text (a tool that answers in a sentence, not JSON). */
export async function callText(
  brain: BrainCall,
  tool: string,
  input: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<string> {
  const parts = await (timeoutMs === undefined
    ? brain.call(tool, input)
    : brain.call(tool, input, timeoutMs));
  const part = parts.find((p) => p.type === 'text');
  return part?.type === 'text' ? part.text : '';
}

export async function callJson(
  brain: BrainCall,
  tool: string,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  const text = await callText(brain, tool, input);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`brain sent bad ${tool} answer`);
  }
}

/** Why a tool that makes a link failed: the network is off, or anything else. */
export function linkFailure(error: unknown): 'network_off' | 'failed' {
  return error instanceof RpcError && error.code === ErrorCode.network_off
    ? 'network_off'
    : 'failed';
}
