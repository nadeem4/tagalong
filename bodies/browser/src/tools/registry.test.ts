/**
 * Tests for the tool registry: what a body declares and how a call finds its tool,
 * and the two errors every tool raises.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { describe, expect, it } from 'vitest';
import { failed, invalid, toolset, type BrowserTool } from './registry';

const echo: BrowserTool = {
  tool: { name: 'echo', description: 'Echo.', input_schema: { type: 'object' }, effect: 'read' },
  run: async (input) => [{ type: 'text', text: JSON.stringify(input) }],
};

describe('toolset', () => {
  it('tools_lists_declared_tools', () => {
    expect(toolset([echo]).tools()).toEqual([echo.tool]);
  });

  it('runs a declared tool with its input', async () => {
    expect(await toolset([echo]).run('echo', { a: 1 })).toEqual([
      { type: 'text', text: '{"a":1}' },
    ]);
  });

  it('run_unknown_tool_is_unknown_tool', async () => {
    const e = await toolset([echo])
      .run('nope', {})
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(ErrorCode.unknown_tool);
  });
});

describe('error helpers', () => {
  it('failed is tool_failed and invalid is invalid_params', () => {
    expect(failed('x').code).toBe(ErrorCode.tool_failed);
    expect(invalid('x').code).toBe(ErrorCode.invalid_params);
    expect(failed('boom').message).toBe('boom');
  });
});
