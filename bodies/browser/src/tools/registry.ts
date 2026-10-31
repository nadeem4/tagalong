/**
 * The body's tools as a set: what it declares to the brain and how a call finds its tool.
 * Also the two errors every tool raises, so a failure always carries a contract code.
 */
import { ErrorCode, RpcError, type Part, type Tool } from '@tagalong/contract';

export interface BrowserTool {
  tool: Tool;
  run(input: Record<string, unknown>): Promise<Part[]>;
}

interface Toolset {
  tools(): Tool[];
  run(name: string, input: Record<string, unknown>): Promise<Part[]>;
}

export function toolset(defs: BrowserTool[]): Toolset {
  const byName = new Map(defs.map((d) => [d.tool.name, d]));
  return {
    tools: () => defs.map((d) => d.tool),
    run(name, input) {
      const def = byName.get(name);
      if (def === undefined)
        return Promise.reject(new RpcError(ErrorCode.unknown_tool, 'unknown tool'));
      return def.run(input);
    },
  };
}

/** The tool tried and could not; the message is shown to the model, so keep it plain. */
export function failed(message: string): RpcError {
  return new RpcError(ErrorCode.tool_failed, message);
}

/** The call itself was malformed. */
export function invalid(message: string): RpcError {
  return new RpcError(ErrorCode.invalid_params, message);
}
