/** Tests for the JSON-RPC request, notification and response envelopes. */
import { describe, expect, it } from 'vitest';
import { RpcNotification, RpcRequest, RpcResponse } from './rpc';

describe('RpcRequest', () => {
  it('parses a request with a string id', () => {
    expect(RpcRequest.parse({ jsonrpc: '2.0', id: 'a1', method: 'ask', params: {} }).method).toBe(
      'ask',
    );
  });

  it('parses a request with a numeric id and no params', () => {
    expect(RpcRequest.parse({ jsonrpc: '2.0', id: 7, method: 'pets.list' }).id).toBe(7);
  });

  it('rejects a wrong jsonrpc version', () => {
    expect(RpcRequest.safeParse({ jsonrpc: '1.0', id: 1, method: 'ask' }).success).toBe(false);
  });

  it('rejects a request with no id', () => {
    expect(RpcRequest.safeParse({ jsonrpc: '2.0', method: 'ask' }).success).toBe(false);
  });
});

describe('RpcNotification', () => {
  it('parses a notification without an id', () => {
    expect(
      RpcNotification.parse({ jsonrpc: '2.0', method: 'turn.delta', params: { text: 'hi' } })
        .method,
    ).toBe('turn.delta');
  });

  it('rejects a notification with no method', () => {
    expect(RpcNotification.safeParse({ jsonrpc: '2.0', params: {} }).success).toBe(false);
  });
});

describe('RpcResponse', () => {
  it('parses a success response', () => {
    expect(RpcResponse.parse({ jsonrpc: '2.0', id: 1, result: { turnId: 'x' } }).id).toBe(1);
  });

  it('parses an error response', () => {
    const parsed = RpcResponse.parse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'no such method' },
    });
    expect(parsed.error?.code).toBe(-32601);
  });

  it('rejects a response carrying both result and error', () => {
    const both = { jsonrpc: '2.0', id: 1, result: {}, error: { code: -1, message: 'x' } };
    expect(RpcResponse.safeParse(both).success).toBe(false);
  });

  it('rejects a response carrying neither result nor error', () => {
    expect(RpcResponse.safeParse({ jsonrpc: '2.0', id: 1 }).success).toBe(false);
  });
});
