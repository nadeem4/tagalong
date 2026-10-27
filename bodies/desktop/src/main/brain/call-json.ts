/**
 * Reads a Home tool's answer: the brain's Home tools return one JSON string in a single text
 * part, so a handler asks for the tool and gets the parsed value, or an error naming the tool.
 */
import type { BrainClient } from './brain-client';

/** All the IPC handlers need of the brain: run one of its tools. */
export type BrainCall = Pick<BrainClient, 'call'>;

export async function callJson(
  brain: BrainCall,
  tool: string,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  const part = (await brain.call(tool, input)).find((p) => p.type === 'text');
  try {
    return JSON.parse(part?.type === 'text' ? part.text : '');
  } catch {
    throw new Error(`brain sent bad ${tool} answer`);
  }
}
