import { z } from 'zod';

/** JSON-RPC 2.0 over WebSocket. Every message is validated on both sides. */
export const RpcId = z.union([z.string(), z.number()]);
export type RpcId = z.infer<typeof RpcId>;

export const RpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: RpcId,
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequest>;

/** A request with no id: the peer must not answer it. */
export const RpcNotification = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RpcNotification = z.infer<typeof RpcNotification>;

export const RpcError = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type RpcError = z.infer<typeof RpcError>;

/**
 * Exactly one of result or error must be present. The spec says so, and letting both
 * through would mean every caller has to decide which one wins.
 */
export const RpcResponse = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: RpcId,
    result: z.unknown().optional(),
    error: RpcError.optional(),
  })
  .refine((r) => (r.result !== undefined) !== (r.error !== undefined), {
    message: 'an RPC response carries exactly one of result or error',
  });
export type RpcResponse = z.infer<typeof RpcResponse>;

/** Standard JSON-RPC codes, plus the ones the engine adds. */
export const RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Engine-specific: the pairing token in hello did not match. */
  unauthorized: -32000,
} as const;
