/**
 * Pins the shared shapes to the spec: the protocol number, the error table and the
 * edges of the tool-name and body-id rules.
 */
import { describe, expect, it } from 'vitest';
import { Body, ErrorCode, ErrorObject, LIMITS, PROTOCOL, Part, Tool } from './shapes.js';

const tool = (name: string) => ({ name, description: 'd', input_schema: {} });

describe('shapes', () => {
  it('is protocol 1', () => {
    expect(PROTOCOL).toBe(1);
  });

  it('exports the limits from the spec', () => {
    expect(LIMITS).toEqual({
      partBytes: 5_000_000,
      messageBytes: 20_000_000,
      replayCount: 500,
      replayMs: 86_400_000,
    });
  });

  it('matches the spec error table', () => {
    expect(ErrorCode).toEqual({
      parse_error: -32700,
      invalid_request: -32600,
      method_not_found: -32601,
      invalid_params: -32602,
      internal_error: -32603,
      version_mismatch: -32000,
      unknown_tool: -32001,
      not_found: -32002,
      denied: -32003,
      timeout: -32004,
      cancelled: -32005,
      body_offline: -32006,
      tool_failed: -32007,
      over_limit: -32008,
    });
  });

  it('accepts only known error codes', () => {
    expect(ErrorObject.safeParse({ code: -32007, message: 'x' }).success).toBe(true);
    expect(ErrorObject.safeParse({ code: -31999, message: 'x' }).success).toBe(false);
  });

  it('limits tool names to 48 chars of [a-z0-9_-] with no double underscore', () => {
    expect(Tool.safeParse(tool('a'.repeat(48))).success).toBe(true);
    expect(Tool.safeParse(tool('a'.repeat(49))).success).toBe(false);
    expect(Tool.safeParse(tool('')).success).toBe(false);
    expect(Tool.safeParse(tool('See_Screen')).success).toBe(false);
    expect(Tool.safeParse(tool('a_b-c1')).success).toBe(true);
    expect(Tool.safeParse(tool('desktop__see')).success).toBe(false);
  });

  it('limits body ids to 32 chars of [a-z0-9-]', () => {
    const body = (id: string) => ({ id, kind: 'desktop', name: 'D' });
    expect(Body.safeParse(body('a'.repeat(32))).success).toBe(true);
    expect(Body.safeParse(body('a'.repeat(33))).success).toBe(false);
    expect(Body.safeParse(body('Desktop')).success).toBe(false);
    expect(Body.safeParse(body('my_body')).success).toBe(false);
  });

  it('rejects a part with ref and no data', () => {
    expect(Part.safeParse({ type: 'file', mime: 'a/b', ref: 'f1' }).success).toBe(false);
    expect(Part.safeParse({ type: 'file', mime: 'a/b', data: 'AA==' }).success).toBe(true);
  });

  it('accepts effect read or change on a tool, nothing else', () => {
    const tool = { name: 'n', description: 'd', input_schema: {} };
    expect(Tool.safeParse({ ...tool, effect: 'read' }).success).toBe(true);
    expect(Tool.safeParse({ ...tool, effect: 'change' }).success).toBe(true);
    expect(Tool.safeParse(tool).success).toBe(true);
    expect(Tool.safeParse({ ...tool, effect: 'write' }).success).toBe(false);
    expect(Tool.safeParse({ ...tool, effect: null }).success).toBe(false);
  });
});
